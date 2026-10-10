import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/authServer'
import { runPolicyCheck } from '@/lib/policyCheck'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// GET ?days=30 — carriers used in the window that did not meet the policy for
// the mode they hauled, plus carriers declined here but active in Brokerware.
export async function GET(request: Request) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 30))
    return NextResponse.json(await runPolicyCheck(days))
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
