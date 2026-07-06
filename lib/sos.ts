// Orchestration for Secretary-of-State enrichment: run a carrier's own SOS
// check and (if it factors) its factor's SOS check, deduping factors so a shared
// factor is pulled from OpenSOS only once.

import { supabaseAdmin } from './supabase'
import { lookupEntity, sosConfigured } from './sosClient'
import { matchSosRecord, sosMatchConfigured, type SosMatch } from './sosMatch'
import { normalizeEntityName, inferStateFromAddress, stateFromZip } from './sosNormalize'

function isoDateOrNull(s: string | null | undefined): string | null {
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return null
}

function joinAddress(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(', ')
}

export function sosPipelineConfigured(): { ok: boolean; missing: string[] } {
  const missing: string[] = []
  if (!sosConfigured()) missing.push('OPENSOS_API_KEY')
  if (!sosMatchConfigured()) missing.push('ANTHROPIC_API_KEY')
  return { ok: missing.length === 0, missing }
}

function matchToCarrierRow(match: SosMatch, state: string | null) {
  return {
    sos_state: state,
    sos_entity_id: match.entity_id,
    sos_status: match.status,
    sos_status_normalized: match.status_normalized,
    sos_entity_type: match.entity_type,
    sos_formation_date: isoDateOrNull(match.formation_date),
    sos_registered_agent: match.registered_agent,
    sos_registered_agent_address: match.registered_agent_address,
    sos_principal_address: match.principal_address,
    sos_officers: match.officers ?? [],
    name_match: match.name_match,
    address_match: match.address_match,
    match_confidence: match.match_confidence,
    mismatches: match.mismatches ?? [],
    risk_flags: match.risk_flags ?? [],
    sos_summary: match.summary,
    checked_at: new Date().toISOString(),
  }
}

function matchToFactorRow(match: SosMatch, state: string | null) {
  return {
    sos_state: state,
    sos_entity_id: match.entity_id,
    sos_status: match.status,
    sos_status_normalized: match.status_normalized,
    sos_entity_type: match.entity_type,
    sos_formation_date: isoDateOrNull(match.formation_date),
    sos_registered_agent: match.registered_agent,
    sos_registered_agent_address: match.registered_agent_address,
    sos_principal_address: match.principal_address,
    sos_officers: match.officers ?? [],
    sos_match_confidence: match.match_confidence,
    sos_summary: match.summary,
    sos_checked_at: new Date().toISOString(),
  }
}

/**
 * Re-pull SOS for a single factor already in the registry (e.g. it may have
 * been dissolved). Uses the factor's stored state unless one is supplied.
 * Always stamps sos_checked_at so we record when it was last verified.
 */
export async function recheckFactorSos(
  factorId: string,
  opts: { state?: string } = {}
): Promise<any> {
  const cfg = sosPipelineConfigured()
  if (!cfg.ok) {
    throw new Error(`SOS pipeline not configured — missing ${cfg.missing.join(', ')}`)
  }

  const { data: factor, error } = await supabaseAdmin
    .from('factors')
    .select('id, name, sos_state')
    .eq('id', factorId)
    .single()
  if (error || !factor) throw new Error('Factor not found')

  const state = (opts.state || (factor as any).sos_state || '').trim().toUpperCase()
  if (!state) {
    throw new Error('No state on file for this factor — provide a 2-letter state to re-check')
  }

  const { raw } = await lookupEntity({
    entityName: (factor as any).name,
    state,
    fresh: true,
  })
  const match = await matchSosRecord(
    { kind: 'factor', name: (factor as any).name, state },
    raw
  )
  const { data: saved } = await supabaseAdmin
    .from('factors')
    .update({
      ...matchToFactorRow(match, state),
      sos_raw: raw as any,
      updated_at: new Date().toISOString(),
    })
    .eq('id', factorId)
    .select('*')
    .single()
  return saved
}

export interface RunSosResult {
  carrierSos: any | null
  factor: any | null
  factorReused: boolean
  errors: string[]
}

/**
 * Enrich a carrier with SOS data. Pulls the carrier's own entity record and, if
 * the carrier factors, its factor's record. A factor already in the registry with
 * a prior SOS check is reused (no OpenSOS call) unless refreshFactor is set.
 */
export async function runCarrierSos(
  dot: string,
  opts: { fresh?: boolean; refreshFactor?: boolean } = {}
): Promise<RunSosResult> {
  const cfg = sosPipelineConfigured()
  if (!cfg.ok) {
    throw new Error(`SOS pipeline not configured — missing ${cfg.missing.join(', ')}`)
  }

  const result: RunSosResult = {
    carrierSos: null,
    factor: null,
    factorReused: false,
    errors: [],
  }

  // Keep the whole request inside the function limit: the carrier and factor
  // each involve a live OpenSOS scrape, so cap each and skip the factor if the
  // carrier scrape already ate most of the budget.
  const startedAt = Date.now()
  const OVERALL_BUDGET_MS = 45_000

  const { data: carrier, error: carrierErr } = await supabaseAdmin
    .from('carriers')
    .select('id, dot_number, legal_name, street, city, state, zip')
    .eq('dot_number', dot)
    .single()
  if (carrierErr || !carrier) throw new Error('Carrier not found')

  const { data: ins } = await supabaseAdmin
    .from('carrier_insurance')
    .select(
      'is_factoring, pay_to_entity, pay_to_address, authority_original_date, authority_reinstatement_date, rmis_carrier_street, rmis_carrier_city, rmis_carrier_state, rmis_carrier_zip'
    )
    .eq('dot_number', dot)
    .order('updated_at', { ascending: false })
    .limit(1)
  const insurance = ins && ins.length > 0 ? (ins[0] as any) : null

  // --- Carrier's own SOS record -------------------------------------------
  // The carrier's Brokerware address is the FACTOR's remittance address, so use
  // the carrier's real state from RMIS (Mailing_State, else derived from the RMIS
  // ZIP), falling back to Brokerware only if RMIS has nothing.
  const carrierState =
    insurance?.rmis_carrier_state ||
    stateFromZip(insurance?.rmis_carrier_zip) ||
    (carrier as any).state ||
    null
  if (!carrierState) {
    result.errors.push('Carrier has no domicile state (RMIS or Brokerware) — cannot search SOS')
  } else if ((carrier as any).legal_name) {
    try {
      const { raw } = await lookupEntity({
        entityName: (carrier as any).legal_name,
        state: carrierState,
        fresh: opts.fresh,
        timeoutMs: 28_000,
      })
      const match = await matchSosRecord(
        {
          kind: 'carrier',
          name: (carrier as any).legal_name,
          address: joinAddress([
            insurance?.rmis_carrier_street ?? (carrier as any).street,
            insurance?.rmis_carrier_city ?? (carrier as any).city,
            carrierState,
            insurance?.rmis_carrier_zip ?? (carrier as any).zip,
          ]),
          state: carrierState,
          authorityOriginalDate: insurance?.authority_original_date ?? null,
          authorityReinstatementDate: insurance?.authority_reinstatement_date ?? null,
        },
        raw
      )
      const row = {
        carrier_id: (carrier as any).id,
        dot_number: dot,
        ...matchToCarrierRow(match, carrierState),
        sos_raw: raw as any,
        updated_at: new Date().toISOString(),
      }
      const { data: saved } = await supabaseAdmin
        .from('carrier_sos')
        .upsert(row, { onConflict: 'dot_number' })
        .select('*')
        .single()
      result.carrierSos = saved ?? row
    } catch (e) {
      result.errors.push(`Carrier SOS: ${e instanceof Error ? e.message : 'failed'}`)
    }
  }

  // --- Factor SOS record (deduped) ----------------------------------------
  const factorTimeLeft = OVERALL_BUDGET_MS - (Date.now() - startedAt)
  if (
    insurance?.is_factoring &&
    insurance.pay_to_entity &&
    factorTimeLeft < 8_000
  ) {
    // Not enough time budget left for a second live scrape — do the carrier now
    // and leave the factor to be pulled from the Factors page.
    result.errors.push(
      'Factor SOS skipped to stay within the time limit — pull it from the Factors page (Re-check SOS)'
    )
  } else if (insurance?.is_factoring && insurance.pay_to_entity) {
    try {
      const factorName: string = insurance.pay_to_entity
      const normalized = normalizeEntityName(factorName)

      const { data: existing } = await supabaseAdmin
        .from('factors')
        .select('*')
        .eq('normalized_name', normalized)
        .limit(1)
      const existingFactor = existing && existing.length > 0 ? (existing[0] as any) : null

      // Reuse a previously-checked factor unless a refresh was requested.
      if (existingFactor?.sos_checked_at && !opts.refreshFactor) {
        result.factor = existingFactor
        result.factorReused = true
      } else {
        const factorState =
          inferStateFromAddress(insurance.pay_to_address) || carrierState || null
        if (!factorState) {
          result.errors.push('Factor has no resolvable state — cannot search SOS')
        }

        let factorRow: any = {
          name: factorName,
          normalized_name: normalized,
          updated_at: new Date().toISOString(),
        }
        if (factorState) {
          const { raw } = await lookupEntity({
            entityName: factorName,
            state: factorState,
            fresh: opts.fresh,
            timeoutMs: Math.max(8_000, factorTimeLeft),
          })
          const match = await matchSosRecord(
            { kind: 'factor', name: factorName, address: insurance.pay_to_address, state: factorState },
            raw
          )
          factorRow = {
            ...factorRow,
            ...matchToFactorRow(match, factorState),
            sos_raw: raw as any,
          }
        }
        // Insert keeps default approval_status='review'; update preserves the
        // existing approval decision (we only touch SOS + name columns).
        const { data: saved } = await supabaseAdmin
          .from('factors')
          .upsert(factorRow, { onConflict: 'normalized_name' })
          .select('*')
          .single()
        result.factor = saved ?? factorRow
      }

      // Link the carrier to the (deduped) factor.
      if (result.factor?.id) {
        await supabaseAdmin
          .from('carriers')
          .update({ factor_id: result.factor.id })
          .eq('dot_number', dot)
      }
    } catch (e) {
      result.errors.push(`Factor SOS: ${e instanceof Error ? e.message : 'failed'}`)
    }
  }

  return result
}
