import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getSessionUser } from '@/lib/authServer'
import { isRole } from '@/lib/roles'
import type { TeamMember } from '@/lib/assignments'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — everyone who can work carriers (profiles with a portal role), plus how
// many carriers each one currently owns. Any signed-in user may read this: the
// table's "Assigned to" filter and the carrier page's owner picker need it.
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const [profilesRes, countsRes] = await Promise.all([
    (supabaseAdmin as any)
      .from('profiles')
      .select('id, email, full_name, role')
      .order('full_name', { ascending: true, nullsFirst: false }),
    (supabaseAdmin as any).from('carrier_assignments').select('assignee_id').limit(100000),
  ])
  const counts = new Map<string, number>()
  for (const r of (countsRes.data ?? []) as any[]) {
    const id = String(r.assignee_id)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const members: (TeamMember & { assigned: number })[] = ((profilesRes.data ?? []) as any[])
    .filter((p) => isRole(p.role))
    .map((p) => ({
      id: String(p.id),
      email: p.email ?? null,
      full_name: p.full_name ?? null,
      role: p.role,
      assigned: counts.get(String(p.id)) ?? 0,
    }))
  return NextResponse.json({ members, me: { id: user.id, role: user.role } })
}
