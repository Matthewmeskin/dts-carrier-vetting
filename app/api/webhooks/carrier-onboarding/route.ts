import { NextResponse } from 'next/server'
import { isMachineOrSessionAuthorized } from '@/lib/machineAuth'
import { onboardCarrier, type OnboardingInput } from '@/lib/onboarding'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// POST /api/webhooks/carrier-onboarding
//
// Called by the n8n "Carrier OSINT" workflow when RMIS sends a New Registered
// Carrier notice (after the workflow has run its web research). Creates or
// updates the carrier, pulls RMIS + SOS, stores the OSINT, evaluates the
// vetting checklist, sets the status (Approved / Pending Review / On Hold),
// seeds the payment baseline from the RMIS pay to, and returns the decision
// plus the carrier context so the workflow can email a short summary.
//
// Body:
// {
//   dot, mc, legalName, dbaName, street, city, state, zip, phone, email,
//   rmisInsuredId, isFactoring, payToName, payToAddress,
//   osint: { address_lookup, phone_osint, phone_fraud_search, complaints,
//            chameleon_flags[], chameleon_flag_count, chameleon_detail,
//            web_presence, sos_cross_check },
//   source?: 'rmis_onboarding'
// }
export async function POST(request: Request) {
  if (!(await isMachineOrSessionAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const dot = String(body?.dot ?? body?.dotNumber ?? '').replace(/\D/g, '')
  if (!dot) return NextResponse.json({ error: 'dot is required' }, { status: 400 })

  const input: OnboardingInput = {
    dot,
    mc: body.mc ?? body.mcNumber ?? null,
    legalName: body.legalName ?? body.carrierName ?? null,
    dbaName: body.dbaName ?? null,
    street: body.street ?? null,
    city: body.city ?? null,
    state: body.state ?? null,
    zip: body.zip ?? null,
    phone: body.phone ?? null,
    email: body.email ?? null,
    rmisInsuredId: body.rmisInsuredId ?? body.rmisCarrierId ?? null,
    isFactoring: typeof body.isFactoring === 'boolean' ? body.isFactoring : /^(yes|true)$/i.test(String(body.isFactoring ?? '')),
    payToName: body.payToName ?? null,
    payToAddress: body.payToAddress ?? null,
    osint: body.osint && typeof body.osint === 'object' ? body.osint : null,
    source: body.source ?? 'rmis_onboarding',
    skipRmis: body.skipRmis === true,
    skipSos: body.skipSos === true,
  }

  try {
    const result = await onboardCarrier(input)
    const ctx = result.context
    return NextResponse.json({
      ok: true,
      dot,
      created: result.created,
      status: result.statusWritten ?? ctx?.carrier?.carrier_status ?? null,
      statusChanged: result.statusChanged,
      decision: result.decision.decision,
      reasons: result.decision.reasons,
      followUps: result.decision.followUps,
      approvalLevel: result.decision.approvalLevel,
      checks: {
        passed: result.decision.passed,
        failed: result.decision.failed,
        missing: result.decision.missing,
      },
      rmis: result.rmis,
      sos: result.sos,
      osintStored: result.osintStored,
      baseline: result.baseline,
      profileUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/carriers/${dot}`,
      context: ctx,
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, dot, error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
