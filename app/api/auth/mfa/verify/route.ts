import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createSupabaseServerClient } from '@/lib/supabaseServer'
import {
  hashCode,
  signMfaCookie,
  MFA_COOKIE,
  MFA_COOKIE_TTL_MS,
  MFA_MAX_ATTEMPTS,
} from '@/lib/mfa'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/auth/mfa/verify { code } — verify the emailed code for the signed-in
// user and, on success, set the signed MFA cookie that unlocks the portal.
export async function POST(request: Request) {
  try {
    const supabase = createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const code = String(body?.code ?? '').replace(/\D/g, '')
    if (code.length !== 6) {
      return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 })
    }

    const db = supabaseAdmin as any
    const { data: rows } = await db
      .from('login_mfa_codes')
      .select('*')
      .eq('user_id', user.id)
      .is('consumed_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
    const row = rows?.[0]
    if (!row) {
      return NextResponse.json(
        { error: 'No active code. Request a new one.' },
        { status: 400 }
      )
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        { error: 'That code expired. Request a new one.' },
        { status: 400 }
      )
    }
    if ((row.attempts ?? 0) >= MFA_MAX_ATTEMPTS) {
      await db
        .from('login_mfa_codes')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', row.id)
      return NextResponse.json(
        { error: 'Too many wrong attempts. Request a new code.' },
        { status: 429 }
      )
    }

    const expected = await hashCode(code, user.id)
    if (expected !== row.code_hash) {
      await db
        .from('login_mfa_codes')
        .update({ attempts: (row.attempts ?? 0) + 1 })
        .eq('id', row.id)
      return NextResponse.json({ error: 'Incorrect code.' }, { status: 400 })
    }

    // Correct — consume the code and set the signed MFA cookie.
    await db
      .from('login_mfa_codes')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', row.id)

    const res = NextResponse.json({ ok: true })
    res.cookies.set(MFA_COOKIE, await signMfaCookie(user.id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: new URL(request.url).protocol === 'https:',
      path: '/',
      maxAge: Math.ceil(MFA_COOKIE_TTL_MS / 1000),
    })
    return res
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Verify failed' }, { status: 500 })
  }
}
