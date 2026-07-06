import { NextResponse } from 'next/server'
import { runCarrierSos, sosPipelineConfigured } from '@/lib/sos'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Live SOS scrapes for some states (CA, IL) can take well over a minute on the
// first, uncached pull. Give the function room so it doesn't die mid-scrape.
export const maxDuration = 300

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

// DELETE — remove the stored SOS record for this carrier. Used when the matched
// entity is wrong (e.g. a same-named but unrelated business) so the reviewer can
// clear it and, if desired, re-run a fresh lookup.
export async function DELETE(
  request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const { error } = await supabaseAdmin
      .from('carrier_sos')
      .delete()
      .eq('dot_number', params.dot)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}
