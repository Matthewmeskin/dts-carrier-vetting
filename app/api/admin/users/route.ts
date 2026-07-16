import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getSessionUser } from '@/lib/authServer'
import { isRole } from '@/lib/roles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Director-only user management. Enforced whenever auth is on; when auth is off
// (AUTH_ENABLED unset) there's no session, so these are unusable by design.
async function requireDirector() {
  const user = await getSessionUser()
  if (!user) return { error: 'Not signed in', status: 401 as const, user: null }
  if (user.role !== 'director')
    return { error: 'Directors only', status: 403 as const, user: null }
  return { error: null, status: 200 as const, user }
}

// GET — list all users + roles.
export async function GET() {
  const gate = await requireDirector()
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { data } = await (supabaseAdmin as any)
    .from('profiles')
    .select('id, email, full_name, role, created_at')
    .order('created_at', { ascending: true })
  return NextResponse.json({ users: data ?? [] })
}

// POST — create a user with a role. Body: { email, password, fullName?, role }.
export async function POST(request: Request) {
  const gate = await requireDirector()
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status })
  try {
    const body = await request.json()
    const email = String(body?.email ?? '').trim().toLowerCase()
    const password = String(body?.password ?? '')
    const fullName = body?.fullName ? String(body.fullName).trim() : null
    const role = isRole(body?.role) ? body.role : 'staff'
    if (!email || password.length < 8) {
      return NextResponse.json(
        { error: 'A valid email and a password of at least 8 characters are required.' },
        { status: 400 }
      )
    }
    const { data: created, error: createErr } = await (supabaseAdmin as any).auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : {},
    })
    if (createErr || !created?.user) {
      return NextResponse.json(
        { error: createErr?.message ?? 'Could not create user' },
        { status: 400 }
      )
    }
    // Ensure the profile carries the chosen role (independent of the trigger).
    await (supabaseAdmin as any)
      .from('profiles')
      .upsert(
        { id: created.user.id, email, full_name: fullName, role, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      )
    return NextResponse.json({ id: created.user.id, email, role })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}

// PATCH — change a user's role. Body: { id, role }.
export async function PATCH(request: Request) {
  const gate = await requireDirector()
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status })
  try {
    const body = await request.json()
    const id = String(body?.id ?? '')
    if (!id || !isRole(body?.role)) {
      return NextResponse.json({ error: 'id and a valid role are required.' }, { status: 400 })
    }
    // Don't let a director strip their own director role and lock themselves out.
    if (id === gate.user!.id && body.role !== 'director') {
      return NextResponse.json({ error: 'You can’t change your own role.' }, { status: 400 })
    }
    const { error } = await (supabaseAdmin as any)
      .from('profiles')
      .update({ role: body.role, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    return NextResponse.json({ id, role: body.role })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}

// DELETE — remove a user. Body: { id }.
export async function DELETE(request: Request) {
  const gate = await requireDirector()
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status })
  try {
    const body = await request.json()
    const id = String(body?.id ?? '')
    if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })
    if (id === gate.user!.id) {
      return NextResponse.json({ error: 'You can’t remove yourself.' }, { status: 400 })
    }
    const { error } = await (supabaseAdmin as any).auth.admin.deleteUser(id)
    if (error) throw error // profile cascades via FK
    return NextResponse.json({ id, deleted: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
