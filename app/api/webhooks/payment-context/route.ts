import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { isMachineOrSessionAuthorized } from '@/lib/machineAuth'

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

    const { data: carrier, error } = await supabaseAdmin
      .from('carriers')
      .select('*')
      .eq('dot_number', dot)
      .maybeSingle()
    if (error) throw error
    if (!carrier) {
      return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })
    }
    const c = carrier as any

    // Latest RMIS insurance/compliance snapshot.
    const { data: ins } = await supabaseAdmin
      .from('carrier_insurance')
      .select('*')
      .eq('dot_number', dot)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const i = (ins as any) ?? {}

    // Carrier Secretary-of-State snapshot.
    const { data: sos } = await (supabaseAdmin as any)
      .from('carrier_sos')
      .select('*')
      .eq('dot_number', dot)
      .maybeSingle()
    const s = (sos as any) ?? {}

    // Approved-factor registry entry (if the carrier is linked to one).
    let factor: any = null
    if (c.factor_id) {
      const { data: f } = await (supabaseAdmin as any)
        .from('factors')
        .select(
          'name, approval_status, sos_status_normalized, sos_entity_type, sos_principal_address, sos_registered_agent, sos_registered_agent_address, sos_state, sos_summary'
        )
        .eq('id', c.factor_id)
        .maybeSingle()
      factor = f ?? null
    }

    // Latest NOA verification result, if any.
    const { data: noaRows } = await (supabaseAdmin as any)
      .from('noa_verifications')
      .select('result, checked_at')
      .eq('dot_number', dot)
      .order('checked_at', { ascending: false })
      .limit(1)
    const noa = (noaRows?.[0] as any) ?? null

    const last4 = (v?: string | null) =>
      v ? String(v).replace(/\D/g, '').slice(-4) || null : null

    // Prefer the RMIS/FMCSA physical address; fall back to the carrier's own.
    const physicalAddress = {
      street: i.rmis_carrier_street ?? c.street ?? null,
      city: i.rmis_carrier_city ?? c.city ?? null,
      state: i.rmis_carrier_state ?? c.state ?? null,
      zip: i.rmis_carrier_zip ?? c.zip ?? null,
      source: i.rmis_carrier_street ? 'RMIS/FMCSA' : 'Brokerware/TMS',
    }

    return NextResponse.json({
      carrier: {
        dot_number: c.dot_number,
        mc_number: c.mc_number ?? null,
        legal_name: c.legal_name ?? null,
        dba_name: c.dba_name ?? null,
        phone: c.phone ?? null,
        email: c.email ?? null,
        safety_rating: c.safety_rating ?? null,
        carrier_status: c.carrier_status ?? null,
        do_not_use: !!c.do_not_use,
        do_not_use_reason: c.do_not_use_reason ?? null,
        is_intrastate: !!c.is_intrastate,
      },
      physical_address: physicalAddress,
      authority: {
        operating_status: i.operating_status ?? null,
        contract_authority_status: i.contract_authority_status ?? null,
        authority_original_date: i.authority_original_date ?? null,
        authority_days_active: i.authority_days_active ?? null,
      },
      insurance: {
        rmis_is_certified: i.rmis_is_certified ?? null,
        hard_stops: i.hard_stops ?? [],
        auto_status: i.auto_status ?? null,
        auto_expiration_date: i.auto_expiration_date ?? null,
        cargo_status: i.cargo_status ?? null,
        cargo_expiration_date: i.cargo_expiration_date ?? null,
        fetched_at: i.fetched_at ?? null,
      },
      identity: {
        w9_on_file: i.w9_on_file ?? null,
        w9_business_name: i.w9_business_name ?? null,
        w9_company_type: i.w9_company_type ?? null,
        w9_tax_id_last4: last4(i.w9_tax_id),
        bca_on_file: i.broker_carrier_agreement_on_file ?? null,
        bca_date: i.broker_carrier_agreement_date ?? null,
      },
      // The remit-to on file — the anchor for the payment-fraud comparison.
      factoring: {
        is_factoring: i.is_factoring ?? null,
        pay_to_entity: i.pay_to_entity ?? null,
        pay_to_address: i.pay_to_address ?? null,
      },
      factor,
      sos: sos
        ? {
            status: s.sos_status_normalized ?? s.sos_status ?? null,
            entity_type: s.sos_entity_type ?? null,
            name_match: s.name_match ?? null,
            address_match: s.address_match ?? null,
            match_confidence: s.match_confidence ?? null,
            principal_address: s.sos_principal_address ?? null,
            registered_agent: s.sos_registered_agent ?? null,
            risk_flags: s.risk_flags ?? [],
            summary: s.sos_summary ?? null,
          }
        : null,
      noa,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
