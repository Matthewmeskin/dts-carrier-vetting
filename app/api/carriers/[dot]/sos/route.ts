import { NextResponse } from 'next/server'
import { runCarrierSos, sosPipelineConfigured } from '@/lib/sos'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// GET — is the SOS pipeline configured? (Lets the UI show/hide the button.)
export async function GET() {
  const cfg = sosPipelineConfigured()
  return NextResponse.json({ configured: cfg.ok, missing: cfg.missing })
}

// POST — run the Secretary-of-State check for this carrier (and its factor).
// Body (optional): { fresh?: boolean, refreshFactor?: boolean }
export async function POST(
  request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const cfg = sosPipelineConfigured()
    if (!cfg.ok) {
      return NextResponse.json(
        {
          error: `Secretary-of-State lookup is not configured. Set ${cfg.missing.join(
            ' and '
          )} in the environment.`,
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

    const result = await runCarrierSos(params.dot, {
      fresh: Boolean(body?.fresh),
      refreshFactor: Boolean(body?.refreshFactor),
    })
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}
