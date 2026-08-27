import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabaseServer'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Cross-portal single sign-on. The AP payables portal and this portal share
// one Supabase project, so a user signed into one is already a user of the
// other — only the cookies differ by domain. The AP portal hands over its
// access token (in a URL fragment, so it never appears in any server log);
// this endpoint verifies that token against the shared auth server, then
// mints a fresh session of its own via a server-side magic-link exchange.
// Minting a NEW session — rather than adopting the caller's refresh token —
// matters: refresh tokens rotate on use, and two apps sharing one token
// family would eventually log each other out.
export async function POST(request: Request) {
  let accessToken = ''
  try {
    const body = await request.json()
    accessToken = String(body?.access_token ?? '')
  } catch {
    /* falls through to the guard below */
  }
  if (!accessToken) {
    return NextResponse.json({ error: 'missing access_token' }, { status: 400 })
  }

  // Whose token is this? getUser validates the JWT against the auth server —
  // an expired or forged token stops here.
  const { data: who, error: whoErr } = await supabaseAdmin.auth.getUser(accessToken)
  const email = who?.user?.email
  if (whoErr || !email) {
    return NextResponse.json({ error: 'invalid session token' }, { status: 401 })
  }

  // Mint a one-time magic-link token for that user and consume it server-side.
  // generateLink never sends an email; the hashed token goes straight into
  // verifyOtp, which sets this app's session cookies on the response.
  const { data: link, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  const tokenHash = link?.properties?.hashed_token
  if (linkErr || !tokenHash) {
    return NextResponse.json({ error: 'could not create session' }, { status: 500 })
  }

  const supabase = createSupabaseServerClient()
  const { error: otpErr } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  })
  if (otpErr) {
    return NextResponse.json({ error: otpErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
