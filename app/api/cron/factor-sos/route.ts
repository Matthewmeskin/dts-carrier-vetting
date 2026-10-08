import { NextResponse } from 'next/server'
import { recheckFactorSos, sosPipelineConfigured } from '@/lib/sos'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// POST { id, state?, name? } — re-pull Secretary-of-State data for one factor
// on behalf of another DTS portal (the Payables portal hosts the factor
// registry; the SOS pipeline and its API keys live here). Bearer-authenticated
// with PORTAL_LINK_SECRET (or CRON_SECRET), no user session.
export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const ok = [process.env.PORTAL_LINK_SECRET, process.env.CRON_SECRET]
    .filter(Boolean)
    .some((s) => auth === `Bearer ${s}`)
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cfg = sosPipelineConfigured()
  if (!cfg.ok) {
    return NextResponse.json(
      { error: `Secretary-of-State lookup is not configured. Set ${cfg.missing.join(' and ')}.` },
      { status: 503 }
    )
  }
  const body = await request.json().catch(() => ({}))
  const id = String(body?.id ?? '').trim()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  try {
    const factor = await recheckFactorSos(id, {
      state: typeof body?.state === 'string' && body.state.trim() ? body.state.trim() : undefined,
      name: typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : undefined,
    })
    return NextResponse.json({ factor })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Re-check failed' }, { status: 500 })
  }
}
