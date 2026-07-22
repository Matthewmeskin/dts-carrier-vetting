import { NextResponse } from 'next/server'
import { isMachineOrSessionAuthorized } from '@/lib/machineAuth'
import { getCarrierContext } from '@/lib/carrierContext'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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
    const context = await getCarrierContext(dot)
    if (!context) {
      return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })
    }
    return NextResponse.json(context)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
