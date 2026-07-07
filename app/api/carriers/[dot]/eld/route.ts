import { NextResponse } from 'next/server'
import {
  eldConfigured,
  fetchFleetLocations,
  fetchVehicleLocation,
} from '@/lib/eldClient'

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
    return NextResponse.json({ configured: true, mode: 'fleet', ...result })
  } catch (err: any) {
    return NextResponse.json(
      { configured: true, error: err?.message ?? 'ELD lookup failed' },
      { status: 500 }
    )
  }
}
