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

    // Classify each carrier: send an INITIAL request when it first goes due to
    // expire (deduped ~14 days), then a REMINDER once the policy is within
    // REMINDER_DAYS of its expiration and still not updated (at most one reminder
    // per ~20 days). A carrier resolved by RMIS flips off "Due-To-Expire" and
    // drops out of the candidate set automatically.
    const REMINDER_DAYS = 15
    const now = Date.now()
    const since14 = new Date(now - dedupeDays * 864e5).toISOString()
    const sinceReminder = new Date(now - 20 * 864e5).toISOString()
    const lookback = new Date(now - 90 * 864e5).toISOString()

    const { data: recent } = await (supabaseAdmin as any)
      .from('carrier_events')
      .select('dot_number, created_at, detail')
      .eq('event_type', 'insurance_refresh_request')
      .gte('created_at', lookback)
      .order('created_at', { ascending: false })
      .limit(100000)
    const lastAnyByDot = new Map<string, string>()
    const lastReminderByDot = new Map<string, string>()
    for (const e of recent ?? []) {
      const dot = String((e as any).dot_number)
      if (!lastAnyByDot.has(dot)) lastAnyByDot.set(dot, (e as any).created_at)
      if ((e as any)?.detail?.kind === 'reminder' && !lastReminderByDot.has(dot)) {
        lastReminderByDot.set(dot, (e as any).created_at)
      }
    }

    const minExpDays = (c: any): number | null => {
      const ds = [c.auto_expiration_date, c.cargo_expiration_date]
        .map((d: any) => (d ? Math.floor((Date.parse(d) - now) / 864e5) : null))
        .filter((x: any): x is number => x !== null && !Number.isNaN(x))
      return ds.length ? Math.min(...ds) : null
    }
    const classify = (c: any): 'initial' | 'reminder' | null => {
      const dot = String(c.dot_number)
      const lastAny = lastAnyByDot.get(dot)
      const lastRem = lastReminderByDot.get(dot)
      const dLeft = minExpDays(c)
      // Near expiry and previously contacted → a reminder (unless one went out
      // recently).
      if (dLeft !== null && dLeft <= REMINDER_DAYS && lastAny) {
        return !lastRem || lastRem < sinceReminder ? 'reminder' : null
      }
      // Otherwise a first request, deduped to the standard window.
      return !lastAny || lastAny < since14 ? 'initial' : null
    }

    const planned = candidates
      .map((c: any) => ({ c, kind: classify(c), dLeft: minExpDays(c) }))
      .filter((p: any) => p.kind !== null)
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
        wouldSend: planned.length,
        initials: planned.filter((p: any) => p.kind === 'initial').length,
        reminders: planned.filter((p: any) => p.kind === 'reminder').length,
        carriers: planned.map((p: any) => ({
          dot: p.c.dot_number,
          legalName: carrierByDot.get(String(p.c.dot_number))?.legal_name ?? null,
          kind: p.kind,
          daysToExpiration: p.dLeft,
          auto: p.c.auto_status,
          cargo: p.c.cargo_status,
        })),
      })
    }

    let sent = 0
    let failed = 0
    const errors: string[] = []
    for (const { c, kind, dLeft } of planned) {
      const dot = String(c.dot_number)
      const carrier: any = carrierByDot.get(dot)
      const autoExp = isExpiringCoverageStatus(c.auto_status)
      const cargoExp = isExpiringCoverageStatus(c.cargo_status)
      const coverages = [autoExp ? 'Auto liability' : '', cargoExp ? 'Cargo' : ''].filter(Boolean)
      const isReminder = kind === 'reminder'
      const result = await sendInsuranceRefreshRequest({
        dotNumber: dot,
        mcNumber: carrier?.mc_number ?? null,
        legalName: carrier?.legal_name ?? `DOT ${dot}`,
        coverages,
        autoExpiration: autoExp ? c.auto_expiration_date || null : null,
        cargoExpiration: cargoExp ? c.cargo_expiration_date || null : null,
        reminder: isReminder,
        daysToExpiration: dLeft,
      })
      if (result.sent) sent++
      else {
        failed++
        if (result.error) errors.push(`${dot}: ${result.error}`)
      }
      const verb = isReminder ? 'Reminder sent to' : 'Requested updated insurance from'
      await logCarrierEvent({
        dot,
        carrierId: carrier?.id ?? null,
        type: 'insurance_refresh_request',
        summary: result.sent
          ? `${verb} RMIS (${result.to}) — ${coverages.join(' & ')} due to expire${dLeft !== null ? ` (expires in ${dLeft}d)` : ''}.`
          : `Insurance update needed — ${coverages.join(' & ')} due to expire (email not sent: ${result.error}).`,
        detail: {
          to: result.to,
          sent: result.sent,
          error: result.error ?? null,
          kind,
          coverages,
          daysToExpiration: dLeft,
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
      initials: planned.filter((p: any) => p.kind === 'initial').length,
      reminders: planned.filter((p: any) => p.kind === 'reminder').length,
      errors: errors.slice(0, 20),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
