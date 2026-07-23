import { NextResponse } from 'next/server'
import { recheckFactorSos, sosPipelineConfigured } from '@/lib/sos'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// POST — re-pull Secretary-of-State data for one factor (stamps sos_checked_at).
// Body (optional): { state?: "TX" } to override/supply the search state.
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const cfg = sosPipelineConfigured()
    if (!cfg.ok) {
      return NextResponse.json(
        {
          error: `Secretary-of-State lookup is not configured. Set ${cfg.missing.join(
            ' and '
          )}.`,
        },
        { status: 503 }
      )
    }

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }

    const factor = await recheckFactorSos(params.id, {
      state: typeof body?.state === 'string' ? body.state : undefined,
      name: typeof body?.name === 'string' ? body.name : undefined,
    })
    return NextResponse.json({ factor })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}
