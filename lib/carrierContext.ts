import { supabaseAdmin } from '@/lib/supabase'
import { stateFromZip } from '@/lib/sosNormalize'
import {
  createDefaultChecklist,
  attachAutoEvidence,
  applyAutoCompletion,
} from '@/lib/vettingChecklist'

// The carrier snapshot the payment-vetting workflow (and the carrier-profile PDF)
// build on: identity, physical address, authority, insurance, W-9/BCA, factoring,
// factor registry, SOS, and the latest NOA verification. Returns null when the
// carrier isn't found.
export interface CarrierContext {
  carrier: Record<string, any>
  physical_address: Record<string, any>
  authority: Record<string, any>
  insurance: Record<string, any>
  identity: Record<string, any>
  factoring: Record<string, any>
  factor: any
  sos: any
  noa: any
  /** Auto-evaluated vetting checklist (safety assessment, verification, etc.). */
  checklist: Array<{
    category: string
    label: string
    required: boolean
    auto_status: 'pass' | 'fail' | null
    evidence: string | null
  }>
}

export async function getCarrierContext(
  dot: string
): Promise<CarrierContext | null> {
  const { data: carrier, error } = await supabaseAdmin
    .from('carriers')
    .select('*')
    .eq('dot_number', dot)
    .maybeSingle()
  if (error) throw error
  if (!carrier) return null
  const c = carrier as any

  const { data: ins } = await supabaseAdmin
    .from('carrier_insurance')
    .select('*')
    .eq('dot_number', dot)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const i = (ins as any) ?? {}

  const { data: sos } = await (supabaseAdmin as any)
    .from('carrier_sos')
    .select('*')
    .eq('dot_number', dot)
    .maybeSingle()
  const s = (sos as any) ?? {}

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

  const { data: noaRows } = await (supabaseAdmin as any)
    .from('noa_verifications')
    .select('result, checked_at')
    .eq('dot_number', dot)
    .order('checked_at', { ascending: false })
    .limit(1)
  const noa = (noaRows?.[0] as any) ?? null

  // Latest safety scores + documents on file, used to auto-evaluate the vetting
  // checklist (the same evaluation the carrier page shows).
  const { data: scoreRows } = await supabaseAdmin
    .from('carrier_scores')
    .select('*')
    .eq('dot_number', dot)
    .order('release_month', { ascending: false })
    .order('upload_date', { ascending: false })
    .limit(1)
  const scoreRecord = (scoreRows?.[0] as any) ?? null

  const { data: docRows } = await supabaseAdmin
    .from('vetting_documents')
    .select('document_type')
    .eq('dot_number', dot)
  const docTypes = Array.from(
    new Set((docRows ?? []).map((d: any) => d.document_type).filter(Boolean))
  ) as string[]

  const evaluated = applyAutoCompletion(
    attachAutoEvidence(createDefaultChecklist(), {
      safetyRating: c.safety_rating ?? null,
      insurance: i as any,
      score: scoreRecord,
      sos: (sos as any) ?? null,
      documentTypes: docTypes,
      isIntrastate: !!c.is_intrastate,
    })
  )
  // Only surface steps we could actually auto-evaluate (pass/fail). Manual-review
  // steps (no data-derived status) would just render as empty boxes in the
  // report, so they are omitted.
  const checklist = evaluated.steps
    .filter((s) => (s.autoStatus ?? null) !== null)
    .map((s) => ({
      category: s.category as string,
      label: s.label,
      required: s.required,
      auto_status: (s.autoStatus ?? null) as 'pass' | 'fail' | null,
      evidence: s.evidence ?? null,
    }))

  const last4 = (v?: string | null) =>
    v ? String(v).replace(/\D/g, '').slice(-4) || null : null

  // When RMIS gives us the carrier's real physical address, use its state — and
  // if RMIS left the state blank, derive it from the RMIS ZIP rather than
  // borrowing the carriers-table state (which is often the FACTOR's remit-address
  // state, e.g. ONKAR's stored "IL" is really Capital Depot in Des Plaines, while
  // the carrier sits at Whiteland ZIP 46184 = IN). Only fall back to the
  // carriers-table address when RMIS has nothing.
  const usingRmisAddr = !!i.rmis_carrier_street
  const physical_address = {
    street: i.rmis_carrier_street ?? c.street ?? null,
    city: i.rmis_carrier_city ?? c.city ?? null,
    state: usingRmisAddr
      ? i.rmis_carrier_state ?? stateFromZip(i.rmis_carrier_zip) ?? null
      : c.state ?? null,
    zip: i.rmis_carrier_zip ?? c.zip ?? null,
    source: usingRmisAddr ? 'RMIS/FMCSA' : 'Brokerware/TMS',
  }

  return {
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
    physical_address,
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
      auto_limit: i.auto_limit ?? null,
      auto_expiration_date: i.auto_expiration_date ?? null,
      cargo_status: i.cargo_status ?? null,
      cargo_limit: i.cargo_limit ?? null,
      cargo_expiration_date: i.cargo_expiration_date ?? null,
      general_status: i.general_status ?? null,
      general_expiration_date: i.general_expiration_date ?? null,
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
    checklist,
  }
}
