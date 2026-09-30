import { NextResponse } from 'next/server'
import { refreshCarrierRmis } from '@/lib/rmisRefresh'

// The refresh itself lives in lib/rmisRefresh.ts so the onboarding webhook and
// the cron routes run the same pull as the Refresh RMIS button.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const result = await refreshCarrierRmis(params.dot, {
      actor: 'Manual RMIS refresh',
      sourceLabel: 'manual_refresh',
    })
    if (result.source === 'rmis') {
      return NextResponse.json({
        parsed: result.parsed,
        evaluation: result.evaluation,
        documents: result.documents,
      })
    }
    return NextResponse.json({
      ok: true,
      source: result.source,
      basic: result.basic,
      fmcsa: result.fmcsa ?? null,
    })
  } catch (err: any) {
    const msg = err?.message ?? 'Unknown error'
    if (msg === 'Carrier not found') {
      return NextResponse.json({ error: msg }, { status: 404 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
