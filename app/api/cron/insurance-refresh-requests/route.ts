import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { isExpiringCoverageStatus } from '@/lib/rmisEvaluator'
import { sendInsuranceRefreshRequest } from '@/lib/emailAlerts'
import { logCarrierEvent } from '@/lib/auditLog'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

// POST — email RMIS (Truckstop) an updated-insurance request for every carrier
// whose latest coverage is "Due-To-Expire", one carrier per email, and stamp it
// in each carrier's activity log. Deduped so a carrier requested in the last
// `dedupeDays` days is skipped.
//
// Pass {"dryRun": true} to preview the From/To and the carrier list WITHOUT
// sending anything. CRON_SECRET-guarded.
export async function POST(request: Request) {
  try {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    const dryRun = body?.dryRun === true
    const limit = Number(body?.limit) > 0 ? Number(body.limit) : 200
    const dedupeDays = Number(body?.dedupeDays) > 0 ? Number(body.dedupeDays) : 14

    // Carriers whose latest coverage is expiring.
    const { data: ins, error: insErr } = await (supabaseAdmin as any)
      .from('latest_carrier_insurance')
      .select('dot_number, auto_status, cargo_status, auto_expiration_date, cargo_expiration_date')
      .or('auto_status.ilike.%due%to%expire%,cargo_status.ilike.%due%to%expire%')
      .limit(100000)
    if (insErr) throw insErr

    const candidates = (ins ?? []).filter(
      (r: any) =>
        isExpiringCoverageStatus(r.auto_status) ||
        isExpiringCoverageStatus(r.cargo_status)
    )
    if (candidates.length === 0) {
      return NextResponse.json({ candidates: 0, note: 'No carriers with expiring coverage.' })
    }

    // Carrier identity (name, MC, id).
    const dots = candidates.map((c: any) => String(c.dot_number))
    const { data: carriers } = await supabaseAdmin
      .from('carriers')
      .select('id, dot_number, legal_name, mc_number')
      .in('dot_number', dots)
    const carrierByDot = new Map(
      (carriers ?? []).map((c: any) => [String(c.dot_number), c])
    )

    // Skip carriers already requested within the dedupe window.
    const since = new Date(Date.now() - dedupeDays * 24 * 3600 * 1000).toISOString()
    const { data: recent } = await (supabaseAdmin as any)
      .from('carrier_events')
      .select('dot_number')
      .eq('event_type', 'insurance_refresh_request')
      .gte('created_at', since)
      .limit(100000)
    const recentDots = new Set(
      (recent ?? []).map((r: any) => String(r.dot_number))
    )

    const toSend = candidates
      .filter((c: any) => !recentDots.has(String(c.dot_number)))
      .slice(0, limit)

    const from = process.env.ALERT_EMAIL_FROM ?? '(unset)'
    const to = process.env.RMIS_HELP_EMAIL || 'RMISHelp@truckstop.com'
    const replyTo = process.env.ALERT_EMAIL_TO ?? '(unset)'

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        from,
        to,
        replyTo,
        candidates: candidates.length,
        alreadyRequestedRecently: candidates.length - toSend.length,
        wouldSend: toSend.length,
        carriers: toSend.map((c: any) => ({
          dot: c.dot_number,
          legalName: carrierByDot.get(String(c.dot_number))?.legal_name ?? null,
          mc: carrierByDot.get(String(c.dot_number))?.mc_number ?? null,
          auto: c.auto_status,
          cargo: c.cargo_status,
        })),
      })
    }

    let sent = 0
    let failed = 0
    const errors: string[] = []
    for (const c of toSend) {
      const dot = String(c.dot_number)
      const carrier: any = carrierByDot.get(dot)
      const autoExp = isExpiringCoverageStatus(c.auto_status)
      const cargoExp = isExpiringCoverageStatus(c.cargo_status)
      const coverages = [autoExp ? 'Auto liability' : '', cargoExp ? 'Cargo' : ''].filter(Boolean)
      const result = await sendInsuranceRefreshRequest({
        dotNumber: dot,
        mcNumber: carrier?.mc_number ?? null,
        legalName: carrier?.legal_name ?? `DOT ${dot}`,
        coverages,
        autoExpiration: autoExp ? c.auto_expiration_date || null : null,
        cargoExpiration: cargoExp ? c.cargo_expiration_date || null : null,
      })
      if (result.sent) sent++
      else {
        failed++
        if (result.error) errors.push(`${dot}: ${result.error}`)
      }
      await logCarrierEvent({
        dot,
        carrierId: carrier?.id ?? null,
        type: 'insurance_refresh_request',
        summary: result.sent
          ? `Requested updated insurance from RMIS (${result.to}) — ${coverages.join(' & ')} due to expire.`
          : `Insurance update needed — ${coverages.join(' & ')} due to expire (email not sent: ${result.error}).`,
        detail: {
          to: result.to,
          sent: result.sent,
          error: result.error ?? null,
          coverages,
          autoStatus: c.auto_status,
          cargoStatus: c.cargo_status,
          batch: true,
        },
        actor: 'system (insurance batch)',
      })
    }

    return NextResponse.json({
      from,
      to,
      replyTo,
      candidates: candidates.length,
      sent,
      failed,
      errors: errors.slice(0, 20),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
