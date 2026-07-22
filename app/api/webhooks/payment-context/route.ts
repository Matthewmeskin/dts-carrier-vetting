import { NextResponse } from 'next/server'
import { isMachineOrSessionAuthorized } from '@/lib/machineAuth'
import { getCarrierContext } from '@/lib/carrierContext'
import { runCarrierSos, sosPipelineConfigured } from '@/lib/sos'
import { runNoaCheck } from '@/lib/noaCheck'
import { noaVerifyConfigured } from '@/lib/noaVerify'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// A first-time carrier SOS scrape (below) can take a couple of minutes on slow
// states, so give this webhook room. It stays well under the n8n node timeout.
export const maxDuration = 300

// Cap the on-demand SOS scrape so a slow/flaky state can never hang the whole
// vetting run — if it doesn't finish in time we return context without SOS.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('SOS lookup timed out')), ms)
    ),
  ])
}

// GET /api/webhooks/payment-context?dot=1234567
//
// Everything the payment-vetting workflow needs to run its AP fraud checks and
// build the vetting log WITHOUT re-hitting FMCSA / RMIS / SOS — the DTS portal
// already keeps this data current. The n8n workflow pulls this by DOT (with a
// CRON_SECRET bearer) instead of running its own FMCSA/RMIS/SOS nodes.
//
// The single most important field for payment fraud is the on-file remit-to
// (`factoring.pay_to_entity` / `pay_to_address`) — the workflow compares the
// invoice/NOA remit-to against this to catch redirected-payment (BEC) fraud.
export async function GET(request: Request) {
  if (!(await isMachineOrSessionAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const url = new URL(request.url)
    const dot = (url.searchParams.get('dot') ?? '').replace(/\D/g, '')
    if (!dot) {
      return NextResponse.json({ error: 'Missing dot' }, { status: 400 })
    }
    let context = await getCarrierContext(dot)
    if (!context) {
      return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })
    }

    // If we don't yet have a Secretary-of-State record for this carrier, run the
    // check now so the vetting log and the merged Carrier Profile page both show
    // real SOS data instead of "not checked". Best-effort: any failure/timeout
    // just leaves SOS unpopulated and the report still generates.
    if (!context.sos && sosPipelineConfigured().ok) {
      try {
        await withTimeout(runCarrierSos(dot), 180_000)
        context = (await getCarrierContext(dot)) ?? context
      } catch (e) {
        console.error('payment-context: carrier SOS lookup failed:', e)
      }
    }

    // Likewise, if there's an on-file NOA but we've never verified it, run the
    // NOA check now so the "NOA result / checked" fields populate on the report
    // and the carrier profile. Best-effort, bounded.
    if (!context.noa && noaVerifyConfigured()) {
      try {
        const ran = await withTimeout(runNoaCheck(dot), 75_000)
        if (ran) context = (await getCarrierContext(dot)) ?? context
      } catch (e) {
        console.error('payment-context: NOA verification failed:', e)
      }
    }

    return NextResponse.json(context)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
