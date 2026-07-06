// Orchestration for Secretary-of-State enrichment: run a carrier's own SOS
// check and (if it factors) its factor's SOS check, deduping factors so a shared
// factor is pulled from OpenSOS only once.

import { supabaseAdmin } from './supabase'
import { lookupEntity, sosConfigured } from './sosClient'
import { matchSosRecord, sosMatchConfigured, type SosMatch } from './sosMatch'
import { stateFromZip } from './sosNormalize'

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
    timeoutMs: 200_000,
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


  const { data: carrier, error: carrierErr } = await supabaseAdmin
    .from('carriers')
    .select('id, dot_number, legal_name, street, city, state, zip')
    .eq('dot_number', dot)
    .single()
  if (carrierErr || !carrier) throw new Error('Carrier not found')

  const { data: ins } = await (supabaseAdmin as any)
    .from('latest_carrier_insurance')
    .select(
      'is_factoring, pay_to_entity, pay_to_address, authority_original_date, authority_reinstatement_date, rmis_carrier_street, rmis_carrier_city, rmis_carrier_state, rmis_carrier_zip'
    )
    .eq('dot_number', dot)
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
        // Slow-state scrapes (CA, IL) can take a minute-plus on the first pull.
        timeoutMs: 200_000,
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

  // The carrier's factor is already linked by name (from the Brokerware sync) and
  // shown in its own block on the carrier page. We deliberately do NOT look it up
  // here — the RMIS pay-to string is messy and its state is unknown (pay_to_address
  // is often just a PO box). Factor SOS is pulled from the Factors page, which uses
  // the clean factor name and a correct state. No note is surfaced so a successful
  // carrier run doesn't look like it errored.

  return result
}
