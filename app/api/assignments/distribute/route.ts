import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getSessionUser } from '@/lib/authServer'
import { logCarrierEvents, type CarrierEventInput } from '@/lib/auditLog'
import { isBrokerwareDisabled } from '@/lib/revet'
import {
  letterHistogram,
  memberName,
  planDistribution,
  type DistributeMethod,
  type LetterRange,
  type PoolCarrier,
} from '@/lib/assignments'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DECLINED = new Set(['Declined', 'Do Not Use', 'Suspended'])

// POST — hand a slice of the roster out to several people at once.
// Body: {
//   scope: 'active' | 'all',             which carriers are in play
//   pool: 'unassigned' | 'everyone' | 'from', which of those to (re)assign
//   fromId?: string,                     for pool 'from': whose carriers
//   assignees: string[],                 who receives, in order
//   method: 'even' | 'count' | 'alphabet',
//   count?: number, ranges?: LetterRange[],
//   apply?: boolean                      false = preview only
// }
// Managers and directors only. The preview returns the plan and a letter
// histogram of the pool so the UI can suggest balanced ranges.
export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (user.role !== 'manager' && user.role !== 'director') {
    return NextResponse.json({ error: 'Managers and directors only.' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const scope: 'active' | 'all' = body?.scope === 'all' ? 'all' : 'active'
  const pool: 'unassigned' | 'everyone' | 'from' =
    body?.pool === 'everyone' ? 'everyone' : body?.pool === 'from' ? 'from' : 'unassigned'
  const fromId: string | null = body?.fromId ? String(body.fromId) : null
  const method: DistributeMethod =
    body?.method === 'count' ? 'count' : body?.method === 'alphabet' ? 'alphabet' : 'even'
  const assignees: string[] = Array.isArray(body?.assignees)
    ? Array.from(new Set(body.assignees.map((x: unknown) => String(x ?? '')).filter(Boolean)))
    : []
  const count = Number(body?.count) || 0
  const ranges: LetterRange[] = Array.isArray(body?.ranges)
    ? body.ranges
        .map((r: any) => ({ assigneeId: String(r?.assigneeId ?? ''), from: String(r?.from ?? '').toUpperCase(), to: String(r?.to ?? '').toUpperCase() }))
        .filter((r: LetterRange) => r.assigneeId && r.from && r.to)
    : []
  const apply = body?.apply === true

  if (assignees.length === 0) return NextResponse.json({ error: 'Pick at least one person.' }, { status: 400 })
  if (method === 'count' && count < 1) return NextResponse.json({ error: 'Enter how many carriers each person gets.' }, { status: 400 })
  if (method === 'alphabet' && ranges.length === 0) return NextResponse.json({ error: 'Set a letter range for each person.' }, { status: 400 })
  if (pool === 'from' && !fromId) return NextResponse.json({ error: 'Pick whose carriers to redistribute.' }, { status: 400 })

  const [carriersRes, assignRes, profilesRes] = await Promise.all([
    supabaseAdmin
      .from('carriers')
      .select('id, dot_number, legal_name, carrier_status, do_not_use, brokerware_status')
      .limit(100000),
    (supabaseAdmin as any).from('carrier_assignments').select('dot_number, assignee_id').limit(100000),
    (supabaseAdmin as any).from('profiles').select('id, email, full_name, role').in('id', assignees),
  ])
  if (carriersRes.error) return NextResponse.json({ error: carriersRes.error.message }, { status: 500 })

  const valid = new Set(((profilesRes.data ?? []) as any[]).filter((p) => p.role !== 'none').map((p) => String(p.id)))
  const people = assignees.filter((id) => valid.has(id))
  if (people.length === 0) return NextResponse.json({ error: 'None of those people have portal access.' }, { status: 400 })
  const nameById = new Map<string, string>()
  for (const p of (profilesRes.data ?? []) as any[]) nameById.set(String(p.id), memberName(p))

  const owner = new Map<string, string>()
  for (const a of (assignRes.data ?? []) as any[]) owner.set(String(a.dot_number), String(a.assignee_id))

  // The pool: in-scope carriers, narrowed by who owns them today.
  const inScope = ((carriersRes.data ?? []) as any[]).filter((c) => {
    if (c.do_not_use || DECLINED.has(c.carrier_status ?? '')) return false
    if (scope === 'active') {
      if (isBrokerwareDisabled(c.brokerware_status)) return false
      if (c.brokerware_status != null && String(c.brokerware_status).trim().toLowerCase() !== 'active') return false
    }
    return true
  })
  const poolRows: PoolCarrier[] = inScope.filter((c) => {
    const dot = String(c.dot_number)
    if (pool === 'unassigned') return !owner.has(dot)
    if (pool === 'from') return owner.get(dot) === fromId
    return true
  })

  const plan = planDistribution(poolRows, { method, assignees: people, count, ranges })
  const histogram = letterHistogram(poolRows)
  const buckets = plan.buckets.map((b) => ({ ...b, name: nameById.get(b.assigneeId) ?? 'Unknown', count: b.dots.length }))

  if (!apply) {
    return NextResponse.json({
      preview: true,
      poolSize: poolRows.length,
      total: plan.total,
      assigned: plan.assigned,
      leftover: plan.leftover,
      histogram,
      buckets: buckets.map(({ dots, ...rest }) => rest),
    })
  }

  // Apply: upsert every bucket's carriers to their new owner.
  const now = new Date().toISOString()
  const carrierBy = new Map<string, any>()
  for (const c of inScope) carrierBy.set(String(c.dot_number), c)
  const rows: any[] = []
  const events: CarrierEventInput[] = []
  const actor = user.email ?? user.id
  for (const b of buckets) {
    for (const dot of b.dots) {
      rows.push({ dot_number: dot, assignee_id: b.assigneeId, assigned_by: user.id, assigned_at: now })
      if (owner.get(dot) !== b.assigneeId) {
        events.push({
          dot,
          carrierId: carrierBy.get(dot)?.id ?? null,
          type: 'assignment',
          summary: `Assigned to ${b.name} (bulk distribution)`,
          detail: { assignee_id: b.assigneeId, assignee_name: b.name, previous_assignee_id: owner.get(dot) ?? null, method },
          actor,
        })
      }
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await (supabaseAdmin as any)
      .from('carrier_assignments')
      .upsert(rows.slice(i, i + 500), { onConflict: 'dot_number' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  for (let i = 0; i < events.length; i += 500) await logCarrierEvents(events.slice(i, i + 500))

  return NextResponse.json({
    ok: true,
    assigned: plan.assigned,
    leftover: plan.leftover,
    buckets: buckets.map(({ dots, ...rest }) => rest),
  })
}
