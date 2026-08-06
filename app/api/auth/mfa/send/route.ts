import { NextResponse } from 'next/server'
import { randomInt } from 'node:crypto'
import { Resend } from 'resend'
import { supabaseAdmin } from '@/lib/supabase'
import { createSupabaseServerClient } from '@/lib/supabaseServer'
import {
  hashCode,
  MFA_CODE_TTL_MIN,
  MFA_MAX_SENDS,
  MFA_SEND_WINDOW_MIN,
} from '@/lib/mfa'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/auth/mfa/send — email the signed-in user a fresh 6-digit login code.
// Requires a valid (password) Supabase session. Rate-limited per user.
export async function POST() {
  try {
    const supabase = createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    const db = supabaseAdmin as any
    const windowStart = new Date(
      Date.now() - MFA_SEND_WINDOW_MIN * 60 * 1000
    ).toISOString()
    const { count } = await db
      .from('login_mfa_codes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gt('created_at', windowStart)
    if ((count ?? 0) >= MFA_MAX_SENDS) {
      return NextResponse.json(
        { error: 'Too many codes requested. Wait a few minutes and try again.' },
        { status: 429 }
      )
    }

    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.ALERT_EMAIL_FROM
    const email = user.email
    if (!apiKey || !from || !email) {
      return NextResponse.json(
        { error: 'Email delivery is not configured — cannot send a code.' },
        { status: 503 }
      )
    }

    // 6-digit code, stored only as a hash bound to the user.
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const codeHash = await hashCode(code, user.id)
    const expiresAt = new Date(Date.now() + MFA_CODE_TTL_MIN * 60 * 1000).toISOString()

    // Invalidate any prior unconsumed codes, then store the new one.
    await db
      .from('login_mfa_codes')
      .update({ consumed_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('consumed_at', null)
    const { error: insErr } = await db.from('login_mfa_codes').insert([
      {
        user_id: user.id,
        email,
        code_hash: codeHash,
        expires_at: expiresAt,
      },
    ])
    if (insErr) throw insErr

    const resend = new Resend(apiKey)
    const { error: sendErr } = await resend.emails.send({
      from,
      to: email,
      subject: `Your DTS sign-in code: ${code}`,
      html:
        `<p>Your DTS Carrier Portal sign-in code is:</p>` +
        `<p style="font-size:22px;font-weight:bold;letter-spacing:3px">${code}</p>` +
        `<p>It expires in ${MFA_CODE_TTL_MIN} minutes. If you didn't try to sign in, ignore this email.</p>`,
    })

    // Resend reports delivery problems (unverified domain, quota, bad address)
    // in the response rather than by throwing — surface them instead of falsely
    // telling the user a code is on the way. Drop the just-stored code so the
    // failed attempt doesn't burn a slot against the resend rate limit.
    if (sendErr) {
      await db
        .from('login_mfa_codes')
        .update({ consumed_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .is('consumed_at', null)
      const detail =
        (sendErr as any)?.message || (sendErr as any)?.name || 'unknown error'
      return NextResponse.json(
        { error: `Email provider rejected the code (${detail}).` },
        { status: 502 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Could not send code' }, { status: 500 })
  }
}
