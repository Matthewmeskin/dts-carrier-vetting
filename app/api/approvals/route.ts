import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getSessionUser } from '@/lib/authServer'
import { logCarrierEvent } from '@/lib/auditLog'
import { requiredApprovalLevel, ROLE_LABEL, type ApprovalLevel } from '@/lib/roles'
import type { ApprovalRequestRow } from '@/lib/approvals'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// The approval queue. A reviewer whose role can't approve a gated carrier
// submits it here; Managers / Directors work the queue on /approvals.
//
// GET  ?state=pending|decided (default pending) — queue rows with carrier
//      context; ?count=1 returns just { pending: n } for the nav badge.
// POST { dotNumber, requestedStatus, note? } — open (or refresh) the request
//      for a carrier. One open request per carrier.

async function enrich(rows: any[]): Promise<ApprovalRequestRow[]> {
  if (rows.length === 0) return []
  const dots = Array.from(new Set(rows.map((r) => String(r.dot_number))))
  const recordIds = rows.map((r) => r.vetting_record_id).filter(Boolean)
  const [carriersRes, scoresRes, insRes, recsRes] = await Promise.all([
    supabaseAdmin
      .from('carriers')
      .select('dot_number, legal_name, dba_name, mc_number, city, state, carrier_status, safety_rating, brokerware_status, last_hauled_at')
      .in('dot_number', dots),
    (supabaseAdmin as any)
      .from('carrier_scores')
      .select('dot_number, gap_score, flagged_scores, release_month, upload_date')
      .in('dot_number', dots)
      .order('release_month', { ascending: false })
      .order('upload_date', { ascending: false })
      .limit(100000),
    (supabaseAdmin as any)
      .from('carrier_insurance_latest')
      .select('dot_number, hard_stops')
      .in('dot_number', dots),
    recordIds.length
      ? supabaseAdmin
          .from('vetting_records')
          .select('id, exception_note, internal_notes, reviewed_by')
          .in('id', recordIds)
      : Promise.resolve({ data: [] as any[] }),
  ])
  const carrierBy = new Map<string, any>()
  for (const c of carriersRes.data ?? []) carrierBy.set(String((c as any).dot_number), c)
  const scoreBy = new Map<string, any>()
  for (const s of scoresRes.data ?? []) {
    const d = String(s.dot_number)
    if (!scoreBy.has(d)) scoreBy.set(d, s)
  }
  const insBy = new Map<string, any>()
  for (const i of insRes.data ?? []) insBy.set(String(i.dot_number), i)
  const recBy = new Map<string, any>()
  for (const r of (recsRes as any).data ?? []) recBy.set(String(r.id), r)

  return rows.map((r) => {
    const dot = String(r.dot_number)
    const c = carrierBy.get(dot)
    const s = scoreBy.get(dot)
    const rec = r.vetting_record_id ? recBy.get(String(r.vetting_record_id)) : null
    return {
      id: r.id,
      dot_number: dot,
      vetting_record_id: r.vetting_record_id ?? null,
      requested_status: r.requested_status,
      required_level: r.required_level,
      requested_by: r.requested_by,
      requested_at: r.requested_at,
      request_note: r.request_note ?? null,
      decision: r.decision ?? null,
      decided_by: r.decided_by ?? null,
      decided_at: r.decided_at ?? null,
      decision_note: r.decision_note ?? null,
      carrier: c
        ? {
            legal_name: c.legal_name ?? null,
            dba_name: c.dba_name ?? null,
            mc_number: c.mc_number ?? null,
            city: c.city ?? null,
            state: c.state ?? null,
            carrier_status: c.carrier_status ?? null,
            safety_rating: c.safety_rating ?? null,
            brokerware_status: c.brokerware_status ?? null,
            last_hauled_at: c.last_hauled_at ?? null,
          }
        : null,
      gap_score: s?.gap_score ?? null,
      flagged_scores: s?.flagged_scores ?? null,
      hard_stops: insBy.get(dot)?.hard_stops ?? null,
      exception_note: rec?.exception_note ?? null,
      internal_notes: rec?.internal_notes ?? null,
      reviewed_by: rec?.reviewed_by ?? null,
    }
  })
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    const url = new URL(request.url)
    const state = url.searchParams.get('state') === 'decided' ? 'decided' : 'pending'
    if (url.searchParams.get('count') === '1') {
      const { count } = await (supabaseAdmin as any)
        .from('approval_requests')
        .select('id', { count: 'exact', head: true })
        .is('decided_at', null)
      return NextResponse.json({ pending: count ?? 0 })
    }
    let q = (supabaseAdmin as any).from('approval_requests').select('*')
    q =
      state === 'pending'
        ? q.is('decided_at', null).order('requested_at', { ascending: true })
        : q.not('decided_at', 'is', null).order('decided_at', { ascending: false }).limit(200)
    const { data, error } = await q
    if (error) throw error
    return NextResponse.json({ requests: await enrich(data ?? []), role: user.role })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const dot = String(body?.dotNumber ?? '').trim()
    const requestedStatus = body?.requestedStatus === 'Approved' ? 'Approved' : 'Exception Approved'
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 2000) : null
    if (!dot) return NextResponse.json({ error: 'Missing dotNumber' }, { status: 400 })

    const { data: carrier } = await supabaseAdmin
      .from('carriers')
      .select('id, dot_number, legal_name, safety_rating')
      .eq('dot_number', dot)
      .maybeSingle()
    if (!carrier) return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })

    // The level this carrier actually needs, from its current score + rating.
    const { data: scoreRow } = await (supabaseAdmin as any)
      .from('carrier_scores')
      .select('approval_level')
      .eq('dot_number', dot)
      .order('release_month', { ascending: false })
      .order('upload_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    const level: ApprovalLevel = requiredApprovalLevel(
      scoreRow?.approval_level,
      (carrier as any).safety_rating
    )
    if (level === 'none') {
      return NextResponse.json(
        { error: 'This carrier does not need Manager or Director approval — it can be approved directly.' },
        { status: 400 }
      )
    }

    const { data: rec } = await supabaseAdmin
      .from('vetting_records')
      .select('id')
      .eq('dot_number', dot)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const actor = `${user.fullName || user.email || user.id} (${ROLE_LABEL[user.role]})`
    const { data: existing } = await (supabaseAdmin as any)
      .from('approval_requests')
      .select('id')
      .eq('dot_number', dot)
      .is('decided_at', null)
      .maybeSingle()

    const row = {
      dot_number: dot,
      vetting_record_id: (rec as any)?.id ?? null,
      requested_status: requestedStatus,
      required_level: level,
      requested_by: actor,
      requested_at: new Date().toISOString(),
      request_note: note,
    }
    let id: string
    if (existing?.id) {
      const { error } = await (supabaseAdmin as any).from('approval_requests').update(row).eq('id', existing.id)
      if (error) throw error
      id = existing.id
    } else {
      const { data, error } = await (supabaseAdmin as any)
        .from('approval_requests')
        .insert([row])
        .select('id')
        .single()
      if (error) throw error
      id = data.id
    }

    await logCarrierEvent({
      dot,
      carrierId: (carrier as any).id ?? null,
      type: 'approval_requested',
      summary: `Submitted for ${ROLE_LABEL[level as 'manager' | 'director']} approval as ${requestedStatus}${note ? ` — ${note}` : ''}.`,
      detail: { requestId: id, requestedStatus, requiredLevel: level, note, resubmitted: !!existing?.id },
      actor,
    })
    return NextResponse.json({ id, requiredLevel: level, requestedStatus, resubmitted: !!existing?.id })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
