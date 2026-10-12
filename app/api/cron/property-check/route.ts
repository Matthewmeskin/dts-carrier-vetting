import { NextResponse } from 'next/server'
import { propertyLookupConfigured, runPropertyCheck } from '@/lib/propertyCheck'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

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
  // Batch: { dots: string[] } (up to 40), for sweeps. Non-residential results
  // are stored without an activity-log entry.
  if (Array.isArray(body?.dots)) {
    const dots = body.dots.map((d: unknown) => String(d ?? '').replace(/\D/g, '')).filter(Boolean).slice(0, 40)
    const out: any[] = []
    for (const dot of dots) {
      try {
        const r = await runPropertyCheck(dot, {
          actor: 'Automated check',
          force: body?.force === true,
          quietUnlessResidential: true,
        })
        const rec = r.check?.record ?? null
        out.push({
          dot,
          reused: r.reused,
          found: !!r.check?.found,
          source: rec?.source ?? null,
          propertyType: rec?.propertyType ?? null,
          error: r.error ?? null,
        })
      } catch (e: any) {
        out.push({ dot, error: e?.message ?? String(e) })
      }
    }
    return NextResponse.json({ results: out })
  }

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
