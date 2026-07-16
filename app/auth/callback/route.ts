import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabaseServer'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OAuth callback — exchanges the Google auth code for a Supabase session, then
// enforces a company-domain allowlist. Because Google sign-in auto-creates an
// account on first login, an email outside ALLOWED_EMAIL_DOMAINS is signed out
// (and its just-created auth user + profile removed) so it can't linger.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/carriers'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=oauth`)
  }

  const supabase = createSupabaseServerClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=oauth`)
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const email = (user?.email ?? '').toLowerCase()
  const domain = email.split('@')[1] ?? ''

  const allowed = (process.env.ALLOWED_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  // Require an explicit allowlist for Google sign-in (safe default).
  if (!allowed.length || !allowed.includes(domain)) {
    await supabase.auth.signOut()
    if (user?.id) {
      try {
        await (supabaseAdmin as any).auth.admin.deleteUser(user.id)
      } catch {
        /* best-effort cleanup */
      }
    }
    return NextResponse.redirect(`${origin}/login?error=domain`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
