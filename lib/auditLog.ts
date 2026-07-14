// Unified, timestamped audit log for carrier events. Best-effort: logging must
// never break the action it records.

import { supabaseAdmin } from './supabase'

export type CarrierEventType =
  | 'recertification'
  | 'status_change'
  | 'score_upload'
  | 'score_flag'
  | 'rmis_refresh'
  | 'eld_flag'
  | 'sos_check'
  | 'noa_check'
  | 'insurance_change'
  | 'insurance_refresh_request'

export interface CarrierEventInput {
  dot: string
  carrierId?: string | null
  type: CarrierEventType
  summary: string
  detail?: Record<string, unknown> | null
  actor?: string | null
}

function toRow(e: CarrierEventInput) {
  return {
    dot_number: e.dot,
    carrier_id: e.carrierId ?? null,
    event_type: e.type,
    summary: e.summary,
    detail: e.detail ?? null,
    actor: e.actor ?? 'system',
  }
}

/** Log a single carrier event. */
export async function logCarrierEvent(e: CarrierEventInput): Promise<void> {
  try {
    await (supabaseAdmin as any).from('carrier_events').insert([toRow(e)])
  } catch {
    /* best-effort */
  }
}

/** Log many carrier events in one insert. */
export async function logCarrierEvents(events: CarrierEventInput[]): Promise<void> {
  if (events.length === 0) return
  try {
    await (supabaseAdmin as any)
      .from('carrier_events')
      .insert(events.map(toRow))
  } catch {
    /* best-effort */
  }
}
