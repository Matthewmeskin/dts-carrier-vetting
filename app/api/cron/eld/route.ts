import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { eldConfigured, fetchFleetLocations } from '@/lib/eldClient'
import { persistFleetPull } from '@/lib/eldStore'
import { analyzeFleet } from '@/lib/eldAnalysis'
import { maybeFlagForRevet } from '@/lib/eldRevet'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// Small by default — each pull acquires the shared RMIS session lock, so we keep
// batches conservative to avoid contending with the delta poller / backfill.
const DEFAULT_BATCH = 10

// POST — poll a batch of ELD-enrolled carriers for live fleet positions and
// store the snapshot (breadcrumb history + cross-carrier equipment checks).
//
// DISABLED BY DEFAULT: set ELD_POLLER_ENABLED=true to activate. This keeps the
// poller from making live RMIS calls until you explicitly turn it on.
export async function POST(request: Request) {
  try {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (process.env.ELD_POLLER_ENABLED !== 'true') {
      return NextResponse.json({
        disabled: true,
        note: 'Set ELD_POLLER_ENABLED=true to activate ELD polling.',
      })
    }
    if (!eldConfigured()) {
      return NextResponse.json(
        { error: 'RMIS credentials are not configured' },
        { status: 503 }
      )
    }

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    const batchSize =
      Number(body?.batchSize) > 0 ? Number(body.batchSize) : DEFAULT_BATCH

    // ELD-enrolled dots (from the latest RMIS snapshot) + their true domicile
    // state (for the fleet-integrity analysis).
    const { data: enrolled } = await (supabaseAdmin as any)
      .from('latest_carrier_insurance')
      .select('dot_number, rmis_carrier_state')
      .eq('rmis_eld_enrolled', true)
      .limit(100000)
    const dots: string[] = (enrolled ?? []).map((r: any) => String(r.dot_number))
    const domicileByDot: Record<string, string | null> = {}
    for (const r of enrolled ?? []) {
      domicileByDot[String(r.dot_number)] = r.rmis_carrier_state ?? null
    }
    if (dots.length === 0) {
      return NextResponse.json({ processed: 0, note: 'No ELD-enrolled carriers.' })
    }

    // Least-recently-polled first so we cycle the whole enrolled set over time.
    const { data: carriers, error } = await supabaseAdmin
      .from('carriers')
      .select('id, dot_number, power_units, state, eld_polled_at')
      .in('dot_number', dots)
      .order('eld_polled_at', { ascending: true, nullsFirst: true })
      .limit(batchSize)
    if (error) throw error

    let succeeded = 0
    let failed = 0
    let vehicles = 0
    let flaggedForRevet = 0
    const now = new Date().toISOString()

    for (const c of carriers ?? []) {
      const dot = (c as any).dot_number
      try {
        const result = await fetchFleetLocations(dot)
        await persistFleetPull({
          dot,
          carrierId: (c as any).id ?? null,
          result,
          source: 'poller',
        })
        vehicles += result.vehicles.length

        // Same fraud-signal analysis + auto-revet as the on-demand path.
        const analysis = analyzeFleet({
          vehicles: result.vehicles,
          powerUnits: (c as any).power_units ?? null,
          domicileState: domicileByDot[dot] ?? (c as any).state ?? null,
        })
        const revet = await maybeFlagForRevet({ dot, analysis })
        if (revet.flagged) flaggedForRevet++

        succeeded++
      } catch {
        failed++
      } finally {
        await supabaseAdmin
          .from('carriers')
          .update({ eld_polled_at: now } as any)
          .eq('dot_number', dot)
      }
    }

    return NextResponse.json({
      processed: (carriers ?? []).length,
      succeeded,
      failed,
      vehicles,
      flaggedForRevet,
      enrolledTotal: dots.length,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}
