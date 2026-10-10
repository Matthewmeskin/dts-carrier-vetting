import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getSessionUser } from '@/lib/authServer'
import { logCarrierEvent } from '@/lib/auditLog'
import { eventSetsException } from '@/lib/exceptions'
import { roleCanApprove, ROLE_LABEL } from '@/lib/roles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Policy Section 8: approvers review all exception approvals at least
// quarterly. Lists every Exception Approved carrier (and every Section 9
// carrier) with who set it, when it was last reviewed, and whether that
// review is due. POST records a review on the carrier's activity timeline.

const REVIEW_INTERVAL_DAYS = 90

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    const { data: facts, error } = await (supabaseAdmin as any)
      .from('policy_carrier_facts')
      .select('dot_number, legal_name, dba_name, carrier_status, other_mode, gap_score')
      .or('carrier_status.eq.Exception Approved,other_mode.eq.true')
      .limit(2000)
    if (error) throw error
    const dots = (facts ?? []).map((f: any) => String(f.dot_number))
    const events: any[] = []
    for (let i = 0; i < dots.length; i += 200) {
      const { data } = await (supabaseAdmin as any)
        .from('carrier_events')
        .select('dot_number, event_type, detail, actor, created_at, summary')
        .in('dot_number', dots.slice(i, i + 200))
        .in('event_type', ['status_change', 'vetting_saved', 'approval_decided', 'exception_review'])
        .order('created_at', { ascending: false })
        .limit(20000)
      events.push(...(data ?? []))
    }
    const setBy = new Map<string, { actor: string | null; at: string }>()
    const reviewed = new Map<string, { actor: string | null; at: string; note: string | null }>()
    for (const e of events) {
      const d = String(e.dot_number)
      if (e.event_type === 'exception_review') {
        if (!reviewed.has(d)) reviewed.set(d, { actor: e.actor, at: e.created_at, note: e.detail?.note ?? null })
        continue
      }
      if (setBy.has(d)) continue
      const viaQueue =
        e.event_type === 'approval_decided' &&
        e.detail?.decision === 'approved' &&
        e.detail?.requestedStatus === 'Exception Approved'
      if (viaQueue || eventSetsException(e)) setBy.set(d, { actor: e.actor, at: e.created_at })
    }
    const now = Date.now()
    const rows = (facts ?? []).map((f: any) => {
      const d = String(f.dot_number)
      const s = setBy.get(d) ?? null
      const r = reviewed.get(d) ?? null
      const lastAt = r?.at ?? null
      const due = !lastAt || now - Date.parse(lastAt) > REVIEW_INTERVAL_DAYS * 86400000
      return {
        dot: d,
        name: f.legal_name ?? f.dba_name ?? d,
        status: f.carrier_status,
        section9: !!f.other_mode,
        gap: f.gap_score,
        setBy: s?.actor ?? null,
        setAt: s?.at ?? null,
        setByApprover: !!s?.actor && /\(Director\)/.test(s.actor),
        lastReviewedBy: r?.actor ?? null,
        lastReviewedAt: lastAt,
        lastReviewNote: r?.note ?? null,
        due,
      }
    })
    rows.sort((a: any, b: any) => Number(b.due) - Number(a.due) || a.name.localeCompare(b.name))
    return NextResponse.json({ rows, canReview: roleCanApprove(user.role, 'director'), intervalDays: REVIEW_INTERVAL_DAYS })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    if (!roleCanApprove(user.role, 'director')) {
      return NextResponse.json({ error: 'Only an approver (Director access) can record an exception review.' }, { status: 403 })
    }
    const body = await request.json().catch(() => ({}))
    const dot = String(body?.dot ?? '').trim()
    const outcome = body?.outcome === 'change' ? 'change' : 'keep'
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) : ''
    if (!dot) return NextResponse.json({ error: 'Missing dot' }, { status: 400 })
    if (outcome === 'change' && !note) {
      return NextResponse.json({ error: 'Say what needs to change.' }, { status: 400 })
    }
    const { data: carrier } = await supabaseAdmin.from('carriers').select('id').eq('dot_number', dot).maybeSingle()
    if (!carrier) return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })
    await logCarrierEvent({
      dot,
      carrierId: (carrier as any).id ?? null,
      type: 'exception_review',
      summary:
        outcome === 'keep'
          ? `Exception reviewed — keep as is${note ? ` — ${note}` : ''}.`
          : `Exception reviewed — needs change — ${note}`,
      detail: { outcome, note: note || null },
      actor: `${user.fullName || user.email || user.id} (${ROLE_LABEL[user.role]})`,
    })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
