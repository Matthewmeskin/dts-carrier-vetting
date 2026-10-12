import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/authServer'
import {
  latestPropertyCheck,
  propertyLookupConfigured,
  runPropertyCheck,
} from '@/lib/propertyCheck'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — the latest stored property record for this carrier's address.
export async function GET(_req: Request, { params }: { params: { dot: string } }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const dot = params.dot.replace(/\D/g, '')
  return NextResponse.json({
    configured: propertyLookupConfigured(),
    check: await latestPropertyCheck(dot),
  })
}

// A machine caller (n8n) authenticates with the portal link / cron secret.
function isMachine(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  return [process.env.PORTAL_LINK_SECRET, process.env.CRON_SECRET]
    .filter(Boolean)
    .some((s) => auth === `Bearer ${s}`)
}

// POST — look the address up now. Body: { force?: boolean } (skip the 30-day reuse).
export async function POST(req: Request, { params }: { params: { dot: string } }) {
  const machine = isMachine(req)
  const user = machine ? null : await getSessionUser()
  if (!machine && !user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!propertyLookupConfigured())
    return NextResponse.json({ error: 'Property lookup is not configured' }, { status: 503 })
  const dot = params.dot.replace(/\D/g, '')
  const body = await req.json().catch(() => ({}))
  try {
    const r = await runPropertyCheck(dot, {
      actor: user ? user.fullName || user.email || 'staff' : 'Automated check',
      force: body?.force === true,
    })
    if (!r.check) return NextResponse.json({ error: r.error }, { status: 400 })
    return NextResponse.json({ check: r.check, reused: r.reused, error: r.error ?? null })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Lookup failed' }, { status: 500 })
  }
}
