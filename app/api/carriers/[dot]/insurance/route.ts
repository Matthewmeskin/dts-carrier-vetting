import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchExpandedCarrierXML, fetchNonMonitoredCarrier } from '@/lib/rmisClient'
import { parseRMISXML, ParsedRMISData } from '@/lib/rmisParser'
import { evaluateRMIS, RMISEvaluation } from '@/lib/rmisEvaluator'
import { logCarrierEvent } from '@/lib/auditLog'
import { archiveCarrierDocuments } from '@/lib/rmisArchive'
import { TablesInsert, TablesUpdate } from '@/lib/database.types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function nullIfEmpty(v: string | null | undefined): string | null {
  return v && v.trim() !== '' ? v : null
}

// First non-empty value across a set of candidate tag names (the non-monitored
// endpoint isn't documented field-by-field, so we try the likely aliases).
function pickTag(text: string, names: string[]): string {
  for (const n of names) {
    const m = new RegExp(`<${n}>([\\s\\S]*?)</${n}>`, 'i').exec(text)
    if (m && m[1].trim()) return m[1].trim()
  }
  return ''
}

// Fields from the RMIS NonAttachedCarrierStatusRequestAPI response (verified
// against a real payload). This endpoint returns identity + the RMIS carrier id
// + which coverages have a COI + client-rule pass/fail. It does NOT return
// operating authority, insurance limits, or safety rating — for those we retry
// the full Expanded Carrier pull using the RMIS carrier id (see below).
function parseNonMonitoredBasics(text: string) {
  const existsInRmis = /<ExistsInRMISSystem>\s*Yes\s*<\/ExistsInRMISSystem>/i.test(text)
  // Which coverages have an active COI on file (AUTO / CARGO / GENERAL ...).
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
    // "Meets client rules" is the closest thing to a pass signal it returns.
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

export async function GET(
  request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const dot = params.dot

    const { data: carrier, error: carrierError } = await supabaseAdmin
      .from('carriers')
      .select('*')
      .eq('dot_number', dot)
      .single()

    if (carrierError || !carrier) {
      return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })
    }

    let xml: string
    try {
      xml = await fetchExpandedCarrierXML({
        insdID: (carrier as any).rmis_insured_id || undefined,
        dotNumber: (carrier as any).dot_number,
      })
    } catch (expandedErr: any) {
      // The carrier isn't attached to our monitored list ("Insured not found").
      if (!/not\s*found/i.test(String(expandedErr?.message ?? ''))) throw expandedErr

      const text = await fetchNonMonitoredCarrier({
        dotNumber: (carrier as any).dot_number,
        mcNumber: (carrier as any).mc_number || undefined,
      })
      const basics = parseNonMonitoredBasics(text)

      // The non-monitored response has no authority/insurance/safety — but it
      // does give the RMIS carrier id. If the carrier exists in RMIS, retry the
      // FULL Expanded pull by that insured id (works even when it isn't attached
      // to us). Remember the id so future refreshes go straight to the full pull.
      let fullXml: string | null = null
      if (basics.rmisCarrierId) {
        await supabaseAdmin
          .from('carriers')
          .update({ rmis_insured_id: basics.rmisCarrierId } as any)
          .eq('dot_number', dot)
        try {
          fullXml = await fetchExpandedCarrierXML({ insdID: basics.rmisCarrierId })
        } catch (retryErr: any) {
          if (!/not\s*found/i.test(String(retryErr?.message ?? ''))) throw retryErr
        }
      }

      if (!fullXml) {
        // Couldn't get the full record — store the accurate basics (identity +
        // COI coverages + client-rule result). Do NOT fabricate authority or
        // hard stops from data the endpoint never returned.
        const coiNote = basics.coiCoverages.length
          ? `COI on file: ${basics.coiCoverages.join(', ')}. `
          : ''
        const basicRow: TablesInsert<'carrier_insurance'> = {
          carrier_id: (carrier as any).id,
          dot_number: dot,
          rmis_carrier_street: nullIfEmpty(basics.street),
          rmis_carrier_city: nullIfEmpty(basics.city),
          rmis_carrier_state: nullIfEmpty(basics.state),
          rmis_carrier_zip: nullIfEmpty(basics.zip),
          hard_stops: [],
          rmis_flags: [],
          rmis_overall_pass: basics.passesBusinessRules,
          rmis_is_certified: null,
          rmis_certification_notes: [
            `Non-monitored RMIS check — this carrier isn't attached to our RMIS ` +
              `client, so authority/insurance detail isn't available. ` +
              `${coiNote}Client rules: DOT ${basics.dotOk ? 'OK' : 'not OK'}, ` +
              `Insurance ${basics.insuranceOk ? 'OK' : 'not OK'}. ` +
              `Attach the carrier in RMIS to pull the full compliance record.`,
          ],
          raw_rmis_response: { source: 'non_monitored', text } as any,
          fetched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        await supabaseAdmin.from('carrier_insurance').insert([basicRow])

        await logCarrierEvent({
          dot,
          carrierId: (carrier as any).id ?? null,
          type: 'rmis_refresh',
          summary:
            'Non-monitored RMIS check (carrier not attached) — identity + COI/client-rule status only.',
          detail: {
            source: 'non_monitored',
            existsInRmis: basics.existsInRmis,
            coiCoverages: basics.coiCoverages,
            dotOk: basics.dotOk,
            insuranceOk: basics.insuranceOk,
          },
          actor: 'system (manual RMIS refresh)',
        })

        return NextResponse.json({ ok: true, source: 'non_monitored', basic: basics })
      }

      // Got the full Expanded record by insured id — parse it like a normal pull.
      xml = fullXml
    }

    const parsed = parseRMISXML(xml)
    const evaluation = evaluateRMIS(parsed)

    // Previous latest insurance row (to compare hard stops)
    const { data: prevRows } = await supabaseAdmin
      .from('carrier_insurance')
      .select('*')
      .eq('dot_number', dot)
      .order('updated_at', { ascending: false })
      .limit(1)
    const prev: any = prevRows && prevRows.length > 0 ? prevRows[0] : null
    const prevHadHardStops = (prev?.hard_stops?.length ?? 0) > 0

    const row = buildInsuranceRow((carrier as any).id, dot, parsed, evaluation, xml)

    const { error: insertError } = await supabaseAdmin
      .from('carrier_insurance')
      .insert([row])
    if (insertError) throw insertError

    // Update carrier rmis_insured_id and safety_rating
    const carrierUpdates: TablesUpdate<'carriers'> = {}
    if (parsed.rmisCarrierID) carrierUpdates.rmis_insured_id = parsed.rmisCarrierID
    if (parsed.safetyRating) carrierUpdates.safety_rating = parsed.safetyRating
    if (Object.keys(carrierUpdates).length > 0) {
      await supabaseAdmin.from('carriers').update(carrierUpdates).eq('dot_number', dot)
    }

    // Record newly-appeared hard stops so the daily digest surfaces them (no
    // instant email).
    if (evaluation.hardStops.length > 0 && !prevHadHardStops) {
      await logCarrierEvent({
        dot,
        carrierId: (carrier as any).id ?? null,
        type: 'hard_stop',
        summary: `New hard stop(s) on manual RMIS refresh: ${evaluation.hardStops.join('; ')}`.slice(0, 300),
        detail: { hardStops: evaluation.hardStops, flags: evaluation.flags, source: 'manual_refresh' },
        actor: 'system (manual RMIS refresh)',
      })
    }

    // Snapshot RMIS documents (COI, W-9, agreement), keeping prior versions.
    let documents = { archived: 0, unchanged: 0, errors: [] as string[] }
    const insdID = parsed.rmisCarrierID || (carrier as any).rmis_insured_id
    if (insdID) {
      try {
        documents = await archiveCarrierDocuments({
          dot,
          carrierId: (carrier as any).id,
          insdID: String(insdID),
          xml,
        })
      } catch (archiveErr) {
        documents.errors.push(
          archiveErr instanceof Error ? archiveErr.message : 'archive failed'
        )
      }
    }

    try {
      const { logCarrierEvent } = await import('@/lib/auditLog')
      await logCarrierEvent({
        dot,
        carrierId: (carrier as any).id ?? null,
        type: 'rmis_refresh',
        summary: `RMIS refreshed — ${
          parsed.rmisIsCertified ? 'certified' : 'not certified'
        }${evaluation.hardStops.length > 0 ? `, ${evaluation.hardStops.length} hard stop(s)` : ''}.`,
        detail: {
          certified: parsed.rmisIsCertified,
          hardStops: evaluation.hardStops,
          flags: evaluation.flags,
        },
        actor: 'Manual RMIS refresh',
      })
    } catch {
      /* best-effort */
    }

    return NextResponse.json({ parsed, evaluation, documents })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
