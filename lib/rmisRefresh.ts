import { supabaseAdmin } from '@/lib/supabase'
import { fetchExpandedCarrierXML, fetchNonMonitoredCarrier } from '@/lib/rmisClient'
import { parseRMISXML, ParsedRMISData } from '@/lib/rmisParser'
import { evaluateRMIS, RMISEvaluation } from '@/lib/rmisEvaluator'
import { logCarrierEvent } from '@/lib/auditLog'
import { isBrokerwareActive } from '@/lib/revet'
import { archiveCarrierDocuments } from '@/lib/rmisArchive'
import { fetchFmcsaCarrier, fmcsaConfigured } from '@/lib/fmcsaClient'
import { TablesInsert, TablesUpdate } from '@/lib/database.types'

// The RMIS refresh, factored out of GET /api/carriers/[dot]/insurance so the
// onboarding webhook (and any other automation) can run the exact same pull the
// "Refresh RMIS" button runs, without going through the session gated route.

function nullIfEmpty(v: string | null | undefined): string | null {
  return v && v.trim() !== '' ? v : null
}

// RMIS signals a carrier isn't in OUR monitored list a few different ways:
//   "Insured not found", "Carrier does not belong to this client", etc.
const NOT_ATTACHED_RE = /not\s*found|does\s*not\s*belong|not\s*attached/i
function isNotAttachedError(err: unknown): boolean {
  return NOT_ATTACHED_RE.test(String((err as any)?.message ?? ''))
}

function pickTag(text: string, names: string[]): string {
  for (const n of names) {
    const m = new RegExp(`<${n}>([\\s\\S]*?)</${n}>`, 'i').exec(text)
    if (m && m[1].trim()) return m[1].trim()
  }
  return ''
}

function parseNonMonitoredBasics(text: string) {
  const existsInRmis = /<ExistsInRMISSystem>\s*Yes\s*<\/ExistsInRMISSystem>/i.test(text)
  const coiCoverages = Array.from(
    text.matchAll(/<CoverageDescription>([^<]+)<\/CoverageDescription>/gi)
  )
    .map((m) => m[1].trim().toUpperCase())
    .filter((v, i, a) => v && a.indexOf(v) === i)
  const dotOk = /<DOT_OK>\s*Yes\s*<\/DOT_OK>/i.test(text)
  const insuranceOk = /<Insurance_OK>\s*Yes\s*<\/Insurance_OK>/i.test(text)
  return {
    legalName: pickTag(text, ['CompanyName']),
    mcNumber: pickTag(text, ['MCNumber']),
    dotNumber: pickTag(text, ['DOTNumber']),
    rmisCarrierId: pickTag(text, ['RMISCarrierID']),
    phone: pickTag(text, ['Phone']),
    email: pickTag(text, ['Email']),
    street: pickTag(text, ['Address1']),
    city: pickTag(text, ['City']),
    state: pickTag(text, ['St', 'State']),
    zip: pickTag(text, ['Zip']),
    existsInRmis,
    coiCoverages,
    dotOk,
    insuranceOk,
    passesBusinessRules: dotOk && insuranceOk ? true : null,
  }
}

// Map ParsedRMISData + evaluation to carrier_insurance row
export function buildInsuranceRow(
  carrierId: string,
  dotNumber: string,
  parsed: ParsedRMISData,
  evaluation: RMISEvaluation,
  rawResponse: string
): TablesInsert<'carrier_insurance'> {
  return {
    carrier_id: carrierId,
    dot_number: dotNumber,
    auto_status: parsed.autoStatus,
    auto_limit: parsed.autoLimit,
    auto_effective_date: nullIfEmpty(parsed.autoEffectiveDate),
    auto_expiration_date: nullIfEmpty(parsed.autoExpirationDate),
    auto_underwriter: parsed.autoUnderwriter,
    auto_underwriter_rating: nullIfEmpty(parsed.autoUnderwriterRating),
    auto_confidence: parsed.autoConfidence,
    auto_policy_number: parsed.autoPolicyNumber,
    cargo_status: parsed.cargoStatus,
    cargo_limit: parsed.cargoLimit,
    cargo_effective_date: nullIfEmpty(parsed.cargoEffectiveDate),
    cargo_expiration_date: nullIfEmpty(parsed.cargoExpirationDate),
    cargo_underwriter: parsed.cargoUnderwriter,
    cargo_underwriter_rating: nullIfEmpty(parsed.cargoUnderwriterRating),
    cargo_confidence: parsed.cargoConfidence,
    cargo_policy_number: parsed.cargoPolicyNumber,
    general_status: parsed.generalStatus,
    general_occurrence_limit: parsed.generalOccurrenceLimit,
    general_aggregate_limit: parsed.generalAggregateLimit,
    general_expiration_date: nullIfEmpty(parsed.generalExpirationDate),
    rmis_is_certified: parsed.rmisIsCertified,
    rmis_certification_notes: parsed.certificationNotes,
    broker_carrier_agreement_on_file: parsed.brokerCarrierAgreementOnFile,
    broker_carrier_agreement_date: nullIfEmpty(parsed.brokerCarrierAgreementDate),
    broker_carrier_agreement_title: parsed.brokerCarrierAgreementTitle,
    w9_on_file: parsed.w9OnFile,
    w9_tax_id: parsed.w9TaxID,
    w9_business_name: parsed.w9BusinessName,
    w9_company_type: parsed.w9CompanyType,
    is_factoring: parsed.isFactoring,
    pay_to_entity: parsed.payToEntity,
    pay_to_address: parsed.payToAddress,
    rmis_carrier_street: parsed.rmisCarrierStreet || null,
    rmis_carrier_city: parsed.rmisCarrierCity || null,
    rmis_carrier_state: parsed.rmisCarrierState || null,
    rmis_carrier_zip: parsed.rmisCarrierZip || null,
    rmis_email: parsed.rmisEmail || null,
    rmis_phone: parsed.rmisPhone || null,
    rmis_contact_name: parsed.rmisContactName || null,
    rmis_contact_title: parsed.rmisContactTitle || null,
    rmis_legal_name: parsed.legalNameRaw || null,
    rmis_dba_name: parsed.dbaNameRaw || null,
    rmis_eld_enrolled: parsed.eldEnrolled,
    operating_status: parsed.operatingStatus,
    common_authority_status: parsed.commonAuthorityStatus,
    contract_authority_status: parsed.contractAuthorityStatus,
    broker_authority_status: parsed.brokerAuthorityStatus,
    authority_original_date: nullIfEmpty(parsed.authorityOriginalDate),
    authority_reinstatement_date: nullIfEmpty(parsed.authorityReinstatedDate),
    authority_revocation_date: nullIfEmpty(parsed.authorityRevocationDate),
    us_total_inspections: parsed.usTotalInspections,
    us_vehicle_oos_ratio: parsed.usVehicleOOSRatio,
    us_driver_oos_ratio: parsed.usDriverOOSRatio,
    us_vehicle_oos_count: parsed.usVehicleOOSCount,
    us_driver_oos_count: parsed.usDriverOOSCount,
    us_fatal_crashes: parsed.usFatalCrashes,
    us_injury_crashes: parsed.usInjuryCrashes,
    us_tow_crashes: parsed.usTowCrashes,
    us_total_crashes: parsed.usTotalCrashes,
    hard_stops: evaluation.hardStops,
    rmis_flags: evaluation.flags,
    rmis_overall_pass: evaluation.overallPass,
    raw_rmis_response: rawResponse,
    fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export interface RmisRefreshResult {
  ok: true
  source: 'rmis' | 'non_monitored' | 'non_monitored+fmcsa'
  parsed?: ParsedRMISData
  evaluation?: RMISEvaluation
  hardStops: string[]
  flags: string[]
  documents?: { archived: number; unchanged: number; errors: string[] }
  basic?: ReturnType<typeof parseNonMonitoredBasics>
  fmcsa?: Record<string, unknown> | null
}

/**
 * Pull the carrier's RMIS record (Expanded, then non monitored + FMCSA fallback),
 * store a carrier_insurance row, update the carrier's rmis_insured_id and safety
 * rating, archive documents, and log events. Throws 'Carrier not found' when the
 * carriers row is missing and rethrows any RMIS error that isn't "not attached".
 */
export async function refreshCarrierRmis(
  dot: string,
  opts: { actor?: string; sourceLabel?: string } = {}
): Promise<RmisRefreshResult> {
  const actor = opts.actor ?? 'Manual RMIS refresh'
  const sourceLabel = opts.sourceLabel ?? 'manual_refresh'

  const { data: carrier, error: carrierError } = await supabaseAdmin
    .from('carriers')
    .select('*')
    .eq('dot_number', dot)
    .single()
  if (carrierError || !carrier) throw new Error('Carrier not found')
  const c = carrier as any

  let xml: string
  try {
    xml = await fetchExpandedCarrierXML({
      insdID: c.rmis_insured_id || undefined,
      dotNumber: c.dot_number,
    })
  } catch (expandedErr: any) {
    if (!isNotAttachedError(expandedErr)) throw expandedErr

    let text = ''
    try {
      text = await fetchNonMonitoredCarrier({
        dotNumber: c.dot_number,
        mcNumber: c.mc_number || undefined,
      })
    } catch {
      /* non monitored lookup unavailable, FMCSA fallback still runs */
    }
    const basics = parseNonMonitoredBasics(text)

    let fullXml: string | null = null
    if (basics.rmisCarrierId) {
      await supabaseAdmin
        .from('carriers')
        .update({ rmis_insured_id: basics.rmisCarrierId } as any)
        .eq('dot_number', dot)
      try {
        fullXml = await fetchExpandedCarrierXML({ insdID: basics.rmisCarrierId })
      } catch (retryErr: any) {
        if (!isNotAttachedError(retryErr)) throw retryErr
      }
    }

    if (!fullXml) {
      let fmcsa: Awaited<ReturnType<typeof fetchFmcsaCarrier>> | null = null
      if (fmcsaConfigured()) {
        try {
          fmcsa = await fetchFmcsaCarrier(dot)
        } catch {
          /* best effort */
        }
      }

      const coiNote = basics.coiCoverages.length
        ? `COI on file: ${basics.coiCoverages.join(', ')}. `
        : ''
      const fmcsaOperating =
        fmcsa?.allowedToOperate == null
          ? null
          : /^y/i.test(fmcsa.allowedToOperate)
            ? 'AUTHORIZED'
            : 'NOT AUTHORIZED'
      const fmcsaNote = fmcsa
        ? `FMCSA: operating ${fmcsaOperating ?? 'unknown'}, safety rating ` +
          `${fmcsa.safetyRating || 'none'}, authority ` +
          `[common ${fmcsa.commonAuthority || '—'}, contract ${
            fmcsa.contractAuthority || '—'
          }, broker ${fmcsa.brokerAuthority || '—'}]. `
        : ''

      const basicRow: TablesInsert<'carrier_insurance'> = {
        carrier_id: c.id,
        dot_number: dot,
        operating_status: fmcsaOperating,
        common_authority_status: fmcsa?.commonAuthority ?? null,
        contract_authority_status: fmcsa?.contractAuthority ?? null,
        broker_authority_status: fmcsa?.brokerAuthority ?? null,
        rmis_carrier_street: nullIfEmpty(fmcsa?.street ?? basics.street),
        rmis_carrier_city: nullIfEmpty(fmcsa?.city ?? basics.city),
        rmis_carrier_state: nullIfEmpty(fmcsa?.state ?? basics.state),
        rmis_carrier_zip: nullIfEmpty(fmcsa?.zip ?? basics.zip),
        rmis_legal_name: nullIfEmpty(fmcsa?.legalName ?? basics.legalName),
        rmis_dba_name: nullIfEmpty(fmcsa?.dbaName ?? null),
        rmis_phone: nullIfEmpty(fmcsa?.phone ?? basics.phone),
        hard_stops: [],
        rmis_flags: [],
        rmis_overall_pass: basics.passesBusinessRules,
        rmis_is_certified: null,
        rmis_certification_notes: [
          `Non-monitored RMIS check — this carrier isn't attached to our RMIS ` +
            `client, so RMIS compliance detail isn't available. ` +
            `${coiNote}${fmcsaNote}Client rules: DOT ${basics.dotOk ? 'OK' : 'not OK'}, ` +
            `Insurance ${basics.insuranceOk ? 'OK' : 'not OK'}. ` +
            `Attach the carrier in RMIS to pull the full compliance record.`,
        ],
        raw_rmis_response: {
          source: 'non_monitored',
          text,
          fmcsa: fmcsa?.raw ?? null,
        } as any,
        fetched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      await supabaseAdmin.from('carrier_insurance').insert([basicRow])

      if (fmcsa) {
        const cu: TablesUpdate<'carriers'> = {}
        if (fmcsa.safetyRating) cu.safety_rating = fmcsa.safetyRating
        if (fmcsa.powerUnits != null) cu.power_units = fmcsa.powerUnits
        if (fmcsa.legalName && !c.legal_name) cu.legal_name = fmcsa.legalName
        if (fmcsa.dbaName && !c.dba_name) cu.dba_name = fmcsa.dbaName
        if (fmcsa.phone && !c.phone) cu.phone = fmcsa.phone
        if (Object.keys(cu).length > 0) {
          await supabaseAdmin.from('carriers').update(cu).eq('dot_number', dot)
        }
      }

      const fmcsaSummary = fmcsa
        ? {
            operating: fmcsaOperating,
            safetyRating: fmcsa.safetyRating,
            commonAuthority: fmcsa.commonAuthority,
            contractAuthority: fmcsa.contractAuthority,
            brokerAuthority: fmcsa.brokerAuthority,
            powerUnits: fmcsa.powerUnits,
          }
        : null

      await logCarrierEvent({
        dot,
        carrierId: c.id ?? null,
        type: 'rmis_refresh',
        summary: fmcsa
          ? 'Non-monitored carrier — identity + COI from RMIS, authority/operating/safety from FMCSA.'
          : 'Non-monitored RMIS check (carrier not attached) — identity + COI/client-rule status only.',
        detail: {
          source: 'non_monitored',
          existsInRmis: basics.existsInRmis,
          coiCoverages: basics.coiCoverages,
          dotOk: basics.dotOk,
          insuranceOk: basics.insuranceOk,
          fmcsa: fmcsaSummary,
        },
        actor,
      })

      return {
        ok: true,
        source: fmcsa ? 'non_monitored+fmcsa' : 'non_monitored',
        hardStops: [],
        flags: [],
        basic: basics,
        fmcsa: fmcsaSummary,
      }
    }

    xml = fullXml
  }

  const parsed = parseRMISXML(xml)
  const evaluation = evaluateRMIS(parsed)

  const { data: prevRows } = await supabaseAdmin
    .from('carrier_insurance')
    .select('*')
    .eq('dot_number', dot)
    .order('updated_at', { ascending: false })
    .limit(1)
  const prev: any = prevRows && prevRows.length > 0 ? prevRows[0] : null
  const prevHadHardStops = (prev?.hard_stops?.length ?? 0) > 0

  const row = buildInsuranceRow(c.id, dot, parsed, evaluation, xml)
  const { error: insertError } = await supabaseAdmin.from('carrier_insurance').insert([row])
  if (insertError) throw insertError

  const carrierUpdates: TablesUpdate<'carriers'> = {}
  if (parsed.rmisCarrierID) carrierUpdates.rmis_insured_id = parsed.rmisCarrierID
  if (parsed.safetyRating) carrierUpdates.safety_rating = parsed.safetyRating
  if (Object.keys(carrierUpdates).length > 0) {
    await supabaseAdmin.from('carriers').update(carrierUpdates).eq('dot_number', dot)
  }

  if (evaluation.hardStops.length > 0 && !prevHadHardStops) {
    await logCarrierEvent({
      dot,
      carrierId: c.id ?? null,
      type: 'hard_stop',
      summary: `New hard stop(s) on RMIS refresh: ${evaluation.hardStops.join('; ')}`.slice(0, 300),
      detail: { hardStops: evaluation.hardStops, flags: evaluation.flags, source: sourceLabel },
      actor,
    })
  }

  if (prevHadHardStops) {
    const norm = (s: string) =>
      s.toLowerCase().replace(/[0-9]+/g, '#').replace(/[^a-z#]+/g, ' ').replace(/\s+/g, ' ').trim()
    const nowKeys = new Set(evaluation.hardStops.map(norm))
    const resolvedHardStops: string[] = (prev?.hard_stops ?? []).filter(
      (h: string) => !nowKeys.has(norm(h))
    )
    if (
      resolvedHardStops.length > 0 &&
      evaluation.hardStops.length === 0 &&
      isBrokerwareActive(c.brokerware_status)
    ) {
      await logCarrierEvent({
        dot,
        carrierId: c.id ?? null,
        type: 'hard_stop_resolved',
        summary: `Hard stop resolved on RMIS refresh: ${resolvedHardStops.join('; ')}${parsed.rmisIsCertified ? ' (RMIS certified)' : ''}`.slice(0, 300),
        detail: { resolved: resolvedHardStops, certified: parsed.rmisIsCertified, source: sourceLabel },
        actor,
      })
    }
  }

  let documents = { archived: 0, unchanged: 0, errors: [] as string[] }
  const insdID = parsed.rmisCarrierID || c.rmis_insured_id
  if (insdID) {
    try {
      documents = await archiveCarrierDocuments({
        dot,
        carrierId: c.id,
        insdID: String(insdID),
        xml,
      })
    } catch (archiveErr) {
      documents.errors.push(archiveErr instanceof Error ? archiveErr.message : 'archive failed')
    }
  }

  await logCarrierEvent({
    dot,
    carrierId: c.id ?? null,
    type: 'rmis_refresh',
    summary: `RMIS refreshed — ${parsed.rmisIsCertified ? 'certified' : 'not certified'}${
      evaluation.hardStops.length > 0 ? `, ${evaluation.hardStops.length} hard stop(s)` : ''
    }.`,
    detail: {
      certified: parsed.rmisIsCertified,
      hardStops: evaluation.hardStops,
      flags: evaluation.flags,
      source: sourceLabel,
    },
    actor,
  })

  return {
    ok: true,
    source: 'rmis',
    parsed,
    evaluation,
    hardStops: evaluation.hardStops,
    flags: evaluation.flags,
    documents,
  }
}
