import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { isMachineOrSessionAuthorized } from '@/lib/machineAuth'
import { getSessionUser } from '@/lib/authServer'
import { logCarrierEvent } from '@/lib/auditLog'
import { evaluateEligibility } from '@/lib/eligibility'
import { normalizeMc } from '@/lib/carrierMatch'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/carriers/check?dot=…  or  ?mc=…   (+ optional &load=…&by=…)
//
// Pre-tender eligibility check for dispatch and automations: is this carrier
// usable under the selection policy right now, and if not, why. Every call is
// written to the carrier's activity timeline with who asked and for which
// load, so the record shows the check was made before the tender — not just
// that the data existed. CRON_SECRET bearer or a signed-in session.
export async function GET(request: Request) {
  try {
    if (!(await isMachineOrSessionAuthorized(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const url = new URL(request.url)
    const dot = (url.searchParams.get('dot') ?? '').trim()
    const mc = normalizeMc(url.searchParams.get('mc'))
    const load = (url.searchParams.get('load') ?? '').trim() || null
    const session = await getSessionUser()
    const by = (url.searchParams.get('by') ?? '').trim() || session?.email || 'automation'
    if (!dot && !mc) {
      return NextResponse.json({ error: 'Pass ?dot= or ?mc=' }, { status: 400 })
    }

    let q = supabaseAdmin
      .from('carriers')
      .select('id, dot_number, mc_number, legal_name, carrier_status, do_not_use, brokerware_status, safety_rating, is_intrastate, created_at, revet_interval_days, revet_reset_at, revet_due_override')
    q = dot ? q.eq('dot_number', dot) : q.ilike('mc_number', `%${mc}`)
    const { data: rows } = await q.limit(5)
    const carrier = (rows ?? []).find((r: any) => !mc || normalizeMc(r.mc_number) === mc) ?? (rows ?? [])[0]
    if (!carrier) {
      return NextResponse.json(
        { eligible: false, found: false, reasons: ['Carrier is not in the vetting portal — it has never been vetted'] },
        { status: 200 }
      )
    }
    const c: any = carrier
    const [insRes, vetRes, scoreRes] = await Promise.all([
      (supabaseAdmin as any)
        .from('carrier_insurance_latest')
        .select('hard_stops, auto_status, cargo_status, fetched_at')
        .eq('dot_number', c.dot_number)
        .maybeSingle(),
      supabaseAdmin
        .from('vetting_records')
        .select('completed_at')
        .eq('dot_number', c.dot_number)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      (supabaseAdmin as any)
        .from('carrier_scores')
        .select('gap_score')
        .eq('dot_number', c.dot_number)
        .order('release_month', { ascending: false })
        .order('upload_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    const ins: any = insRes.data
    const vetted = (vetRes.data as any)?.completed_at ?? null
    const reset = c.revet_reset_at ?? null
    const lastReviewed =
      vetted && reset ? (Date.parse(vetted) >= Date.parse(reset) ? vetted : reset) : vetted ?? reset

    const result = evaluateEligibility({
      carrier_status: c.carrier_status,
      do_not_use: c.do_not_use,
      brokerware_status: c.brokerware_status,
      safety_rating: c.safety_rating ?? null,
      gap_score: (scoreRes.data as any)?.gap_score ?? null,
      hard_stops: ins?.hard_stops ?? null,
      last_reviewed: lastReviewed,
      created_at: c.created_at,
      revet_interval_days: c.revet_interval_days,
      revet_due_override: c.revet_due_override,
      is_intrastate: c.is_intrastate,
    })

    await logCarrierEvent({
      dot: c.dot_number,
      carrierId: c.id,
      type: 'tender_check',
      summary: `Pre-tender check${load ? ` for load ${load}` : ''}: ${result.eligible ? 'ELIGIBLE' : `NOT ELIGIBLE — ${result.reasons.join('; ')}`}.`,
      detail: { load, eligible: result.eligible, reasons: result.reasons, carrierStatus: c.carrier_status, hardStops: result.hardStops },
      actor: by,
    })

    return NextResponse.json({
      found: true,
      eligible: result.eligible,
      reasons: result.reasons,
      carrier: {
        dot_number: c.dot_number,
        mc_number: c.mc_number,
        legal_name: c.legal_name,
        carrier_status: c.carrier_status,
        brokerware_status: c.brokerware_status,
      },
      insurance: ins
        ? { auto_status: ins.auto_status, cargo_status: ins.cargo_status, hard_stops: result.hardStops, fetched_at: ins.fetched_at }
        : null,
      exception: result.exception,
      last_vetted: vetted,
      checked_at: new Date().toISOString(),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
