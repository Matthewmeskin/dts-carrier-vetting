import { createSupabaseServerClient } from './supabaseServer'
import { supabaseAdmin } from './supabase'
import { isRole, type Role } from './roles'

export interface SessionUser {
  id: string
  email: string | null
  role: Role
  fullName: string | null
}

/**
 * The signed-in user + their role, or null if not authenticated. Reads the
 * session from cookies, then the role from `profiles` via the admin client
 * (so RLS recursion can't hide it). Defaults to 'staff' if no profile row yet.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await (supabaseAdmin as any)
    .from('profiles')
    .select('role, full_name, email')
    .eq('id', user.id)
    .maybeSingle()

  const role: Role = isRole(profile?.role) ? profile.role : 'staff'
  return {
    id: user.id,
    email: profile?.email ?? user.email ?? null,
    role,
    fullName: profile?.full_name ?? null,
  }
}
