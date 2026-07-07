import { NextResponse } from 'next/server'
import {
  eldConfigured,
  fetchFleetLocations,
  fetchVehicleLocation,
} from '@/lib/eldClient'
import { analyzeFleet } from '@/lib/eldAnalysis'
import { persistFleetPull } from '@/lib/eldStore'
import { maybeFlagForRevet } from '@/lib/eldRevet'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// ELD lookups hit a live RMIS endpoint (and may queue behind the RMIS session
// lock); give them room but don't let them hang a request forever.
export const maxDuration = 60

// GET /api/carriers/[dot]/eld            → fleet locations
// GET /api/carriers/[dot]/eld?vin=XXXX   → single vehicle location
// GET /api/carriers/[dot]/eld?check=1    → configuration probe only
export async function GET(
  request: Request,
  { params }: { params: { dot: string } }
) {
  const url = new URL(request.url)
  const configured = eldConfigured()

  if (url.searchParams.get('check') === '1') {
    return NextResponse.json({ configured })
  }
  if (!configured) {
    return NextResponse.json(
      {
        configured: false,
        error:
          'ELD lookups are not configured. Set RMIS_CLIENT_ID and RMIS_CLIENT_PASSWORD.',
      },
      { status: 503 }
    )
  }

  try {
    const vin = url.searchParams.get('vin')?.trim()
    if (vin) {
      const result = await fetchVehicleLocation(params.dot, vin)
      return NextResponse.json({ configured: true, mode: 'vehicle', ...result })
    }
    const result = await fetchFleetLocations(params.dot)

    // Pull the carrier's fleet size + true (RMIS) domicile state for the
    // fraud/integrity signals.
    const [{ data: carrier }, { data: ins }] = await Promise.all([
      supabaseAdmin
        .from('carriers')
        .select('id, power_units, state')
        .eq('dot_number', params.dot)
        .single(),
      (supabaseAdmin as any)
        .from('latest_carrier_insurance')
        .select('rmis_carrier_state')
        .eq('dot_number', params.dot)
        .limit(1),
    ])
    const domicileState =
      (ins && ins.length > 0 ? ins[0].rmis_carrier_state : null) ??
      (carrier as any)?.state ??
      null
    const analysis = analyzeFleet({
      vehicles: result.vehicles,
      powerUnits: (carrier as any)?.power_units ?? null,
      domicileState,
    })

    // Persist the snapshot (best-effort) so it feeds history + cross-carrier
    // equipment checks.
    await persistFleetPull({
      dot: params.dot,
      carrierId: (carrier as any)?.id ?? null,
      result,
      source: 'manual',
    })

    // Strong (red) fraud signals auto-flag the carrier for re-vetting.
    const revet = await maybeFlagForRevet({ dot: params.dot, analysis })

    return NextResponse.json({
      configured: true,
      mode: 'fleet',
      ...result,
      analysis,
      autoRevet: revet.flagged,
    })
  } catch (err: any) {
    return NextResponse.json(
      { configured: true, error: err?.message ?? 'ELD lookup failed' },
      { status: 500 }
    )
  }
}
