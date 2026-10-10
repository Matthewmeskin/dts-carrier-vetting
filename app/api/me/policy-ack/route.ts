import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getSessionUser } from '@/lib/authServer'
import { POLICY_VERSION } from '@/lib/policyVersion'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST — the signed-in user acknowledges the current vetting policy version
// (Policy Section 11). Stored on their profile with the date.
export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!POLICY_VERSION) return NextResponse.json({ error: 'No adopted policy version is set.' }, { status: 400 })
  const at = new Date().toISOString()
  const { error } = await (supabaseAdmin as any)
    .from('profiles')
    .update({ policy_ack_version: POLICY_VERSION, policy_ack_at: at })
    .eq('id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, version: POLICY_VERSION, at })
}
