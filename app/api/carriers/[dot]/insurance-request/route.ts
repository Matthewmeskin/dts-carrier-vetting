import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getSessionUser } from '@/lib/authServer'
import { sendInsuranceRefreshRequest } from '@/lib/emailAlerts'
import { logCarrierEvent } from '@/lib/auditLog'
import { isExpiringCoverageStatus } from '@/lib/rmisEvaluator'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST — ask RMIS (Truckstop) by email to pull a carrier's certificate of
// insurance, on demand, for the coverages the user picks.
//
// The nightly batch (/api/cron/insurance-refresh-requests) only chases coverage
// that is "Due-To-Expire". A carrier whose coverage is missing outright —
// "Empty", "No-Current-Info", never filed — never qualifies, yet that's exactly
// the case where someone has the certificate in hand and needs RMIS to carry it.
// This is the manual counterpart: same email, same RMIS inbox, same reply
// capture and activity-log trail, raised by a person from the carrier page.
const COVERAGE_LABEL: Record<string, string> = {
  auto: 'Auto liability',
  cargo: 'Cargo',
  general: 'General liability',
}

export async function POST(
  request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }
    const dot = params.dot

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    const picked: string[] = Array.isArray(body?.coverages)
      ? body.coverages.filter((c: any) => typeof c === 'string' && c in COVERAGE_LABEL)
      : []
    if (picked.length === 0) {
      return NextResponse.json(
        { error: 'Pick at least one coverage to request.' },
        { status: 400 }
      )
    }
    const note =
      typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : null

    const { data: carrier } = await supabaseAdmin
      .from('carriers')
      .select('id, dot_number, legal_name, mc_number')
      .eq('dot_number', dot)
      .maybeSingle()
    if (!carrier) {
      return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })
    }

    // Current coverage state, so the email can quote the right expiration dates
    // and pick its wording (chasing a renewal vs. asking for a missing cert).
    const { data: ins } = await (supabaseAdmin as any)
      .from('carrier_insurance_latest')
      .select('auto_status, cargo_status, general_status, auto_expiration_date, cargo_expiration_date')
      .eq('dot_number', dot)
      .maybeSingle()

    const statusOf = (key: string): string | null =>
      key === 'auto'
        ? ins?.auto_status ?? null
        : key === 'cargo'
          ? ins?.cargo_status ?? null
          : ins?.general_status ?? null

    // "Missing" unless every coverage asked about is merely due to expire — in
    // that case it reads as the renewal chase the batch job would have sent.
    const reason: 'expiring' | 'missing' = picked.every((k) =>
      isExpiringCoverageStatus(statusOf(k))
    )
      ? 'expiring'
      : 'missing'

    const coverages = picked.map((k) => COVERAGE_LABEL[k])
    const result = await sendInsuranceRefreshRequest({
      dotNumber: dot,
      mcNumber: (carrier as any).mc_number ?? null,
      legalName: (carrier as any).legal_name ?? `DOT ${dot}`,
      coverages,
      autoExpiration: picked.includes('auto') ? ins?.auto_expiration_date ?? null : null,
      cargoExpiration: picked.includes('cargo') ? ins?.cargo_expiration_date ?? null : null,
      reason,
      note,
    })

    const statusBits = picked
      .map((k) => `${COVERAGE_LABEL[k]}: ${statusOf(k) ?? 'unknown'}`)
      .join(', ')
    await logCarrierEvent({
      dot,
      carrierId: (carrier as any).id ?? null,
      type: 'insurance_refresh_request',
      summary: result.sent
        ? `Requested ${coverages.join(' & ')} certificate from RMIS (${result.to}) — ${statusBits}.`
        : `RMIS certificate request failed for ${coverages.join(' & ')} (${result.error}).`,
      detail: {
        to: result.to,
        sent: result.sent,
        error: result.error ?? null,
        kind: reason === 'missing' ? 'manual-missing' : 'manual-expiring',
        coverages,
        note,
        autoStatus: ins?.auto_status ?? null,
        cargoStatus: ins?.cargo_status ?? null,
        generalStatus: ins?.general_status ?? null,
        manual: true,
      },
      actor: `${user.email ?? user.id} (manual)`,
    })

    if (!result.sent) {
      return NextResponse.json(
        { error: result.error ?? 'Email not sent', to: result.to },
        { status: 502 }
      )
    }
    return NextResponse.json({ sent: true, to: result.to, coverages, reason })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}
