import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST { email } — asks the n8n relay to mint a Supabase recovery link and
// email it from the Hamilton mailbox. Supabase's own reset mail is sent from a
// shared sender that the dtsone.com tenant drops, so the portals never rely on
// it. Always answers ok so the form can't be used to probe which emails exist.
export async function POST(request: Request) {
  const url = process.env.PASSWORD_RESET_WEBHOOK_URL
  const secret = process.env.PASSWORD_RESET_WEBHOOK_SECRET
  if (!url || !secret) {
    return NextResponse.json({ error: 'Password reset is not configured' }, { status: 503 })
  }

  let email = ''
  try {
    const body = await request.json()
    email = String(body?.email ?? '').trim().toLowerCase()
  } catch {
    /* fall through */
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  }

  // The reset page lives on this portal; the relay only accepts known origins.
  const origin = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/+$/, '')

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-reset-secret': secret },
      body: JSON.stringify({ email, origin }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      console.error('[forgot] relay responded', res.status)
      return NextResponse.json({ error: 'Could not send the reset link right now' }, { status: 502 })
    }
  } catch (err) {
    console.error('[forgot] relay unreachable', err)
    return NextResponse.json({ error: 'Could not send the reset link right now' }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
