import { NextResponse } from 'next/server'
import { propertyLookupConfigured, runPropertyCheck } from '@/lib/propertyCheck'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST { dot, force? } — county property lookup for a carrier's FMCSA address,
// for n8n. Bearer PORTAL_LINK_SECRET or CRON_SECRET. Same code path as the
// "Look up owner & sale history" button on the carrier page.
export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const ok = [process.env.PORTAL_LINK_SECRET, process.env.CRON_SECRET]
    .filter(Boolean)
    .some((s) => auth === `Bearer ${s}`)
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!propertyLookupConfigured())
    return NextResponse.json({ error: 'Property lookup is not configured' }, { status: 503 })

  const body = await request.json().catch(() => ({}))
  const dot = String(body?.dot ?? '').replace(/\D/g, '')
  if (!dot) return NextResponse.json({ error: 'dot is required' }, { status: 400 })
  try {
    const r = await runPropertyCheck(dot, { actor: 'Automated check', force: body?.force === true })
    if (!r.check) return NextResponse.json({ error: r.error }, { status: 400 })
    return NextResponse.json({ check: r.check, reused: r.reused, error: r.error ?? null })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Lookup failed' }, { status: 500 })
  }
}
