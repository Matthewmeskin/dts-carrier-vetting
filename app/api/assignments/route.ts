import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getSessionUser } from '@/lib/authServer'
import { logCarrierEvents, type CarrierEventInput } from '@/lib/auditLog'
import { canAssign, memberName } from '@/lib/assignments'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST { dots: string[], assigneeId: string | null } — set (or clear) the owner
// of one or more carriers. Managers and directors assign anyone; staff may
// claim a carrier for themselves or release one they own.
export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const dots: string[] = Array.isArray(body?.dots)
    ? Array.from(new Set(body.dots.map((d: unknown) => String(d ?? '').trim()).filter(Boolean)))
    : []
  const assigneeId: string | null = body?.assigneeId ? String(body.assigneeId) : null
  if (dots.length === 0) return NextResponse.json({ error: 'No carriers selected.' }, { status: 400 })
  if (dots.length > 5000) return NextResponse.json({ error: 'Too many carriers in one request.' }, { status: 400 })

  // Resolve the new owner's name (and make sure they exist).
  let assigneeName: string | null = null
  if (assigneeId) {
    const { data: prof } = await (supabaseAdmin as any)
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('id', assigneeId)
      .maybeSingle()
    if (!prof || prof.role === 'none') {
      return NextResponse.json({ error: 'That person does not have portal access.' }, { status: 400 })
    }
    assigneeName = memberName(prof)
  }

  const [currentRes, carriersRes] = await Promise.all([
    (supabaseAdmin as any).from('carrier_assignments').select('dot_number, assignee_id').in('dot_number', dots),
    supabaseAdmin.from('carriers').select('id, dot_number, legal_name').in('dot_number', dots),
  ])
  const current = new Map<string, string>()
  for (const r of (currentRes.data ?? []) as any[]) current.set(String(r.dot_number), String(r.assignee_id))
  const carrierBy = new Map<string, any>()
  for (const c of (carriersRes.data ?? []) as any[]) carrierBy.set(String(c.dot_number), c)

  // Permission is per carrier: a staff member may touch only their own.
  const denied = dots.filter((d) => !canAssign(user.role, user.id, current.get(d) ?? null, assigneeId))
  if (denied.length > 0) {
    return NextResponse.json(
      { error: 'Staff can only assign carriers to themselves or release their own. Ask a manager to reassign.' },
      { status: 403 }
    )
  }
  const known = dots.filter((d) => carrierBy.has(d))
  if (known.length === 0) return NextResponse.json({ error: 'No matching carriers.' }, { status: 404 })

  if (assigneeId) {
    const rows = known.map((d) => ({
      dot_number: d,
      assignee_id: assigneeId,
      assigned_by: user.id,
      assigned_at: new Date().toISOString(),
    }))
    const { error } = await (supabaseAdmin as any)
      .from('carrier_assignments')
      .upsert(rows, { onConflict: 'dot_number' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await (supabaseAdmin as any).from('carrier_assignments').delete().in('dot_number', known)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const actor = user.email ?? user.id
  const events: CarrierEventInput[] = known
    .filter((d) => (current.get(d) ?? null) !== assigneeId)
    .map((d) => ({
      dot: d,
      carrierId: carrierBy.get(d)?.id ?? null,
      type: 'assignment',
      summary: assigneeId ? `Assigned to ${assigneeName}` : 'Unassigned',
      detail: { assignee_id: assigneeId, assignee_name: assigneeName, previous_assignee_id: current.get(d) ?? null },
      actor,
    }))
  await logCarrierEvents(events)

  return NextResponse.json({ ok: true, updated: known.length, assigneeName })
}
