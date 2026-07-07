// Auto-flag a carrier for re-vetting when a live ELD pull produces strong
// (red-level) fleet-integrity fraud signals.
//
// Behavior:
//  - Transitions the carrier to "Pending Review" only if it isn't already in a
//    review / do-not-use state (no status churn).
//  - Records the ELD reason in the change history regardless of current status,
//    so an already-pending carrier still gets the ELD signal documented for the
//    audit trail — but deduped to once per DEDUP_DAYS so repeated polls don't
//    spam the log or alerts.

import { supabaseAdmin } from './supabase'
import { isBrokerwareDisabled } from './revet'
import { sendComplianceAlert } from './emailAlerts'
import type { EldFleetAnalysis } from './eldAnalysis'

const ELD_MARKER = 'ELD fleet-integrity fraud signal — auto-flagged for re-vet'
const DEDUP_DAYS = 3

export async function maybeFlagForRevet(params: {
  dot: string
  analysis: EldFleetAnalysis
}): Promise<{ flagged: boolean; transitioned: boolean }> {
  const reds = params.analysis.flags.filter((f) => f.level === 'red')
  if (reds.length === 0) return { flagged: false, transitioned: false }

  try {
    const { data: carrier } = await supabaseAdmin
      .from('carriers')
      .select(
        'id, dot_number, legal_name, carrier_status, do_not_use, brokerware_status, rmis_insured_id'
      )
      .eq('dot_number', params.dot)
      .single()
    if (!carrier) return { flagged: false, transitioned: false }
    const c: any = carrier

    // Disabled carriers don't need a re-vet nudge.
    if (isBrokerwareDisabled(c.brokerware_status)) {
      return { flagged: false, transitioned: false }
    }

    // Dedup: if we already recorded an ELD fraud signal recently, do nothing.
    const since = new Date(
      Date.now() - DEDUP_DAYS * 24 * 3600 * 1000
    ).toISOString()
    const { data: recent } = await supabaseAdmin
      .from('carrier_delta_log')
      .select('id')
      .eq('dot_number', params.dot)
      .contains('change_summary', [ELD_MARKER])
      .gte('detected_at', since)
      .limit(1)
    if (recent && recent.length > 0) {
      return { flagged: false, transitioned: false }
    }

    const alreadyPending =
      c.carrier_status === 'Pending Review' ||
      c.carrier_status === 'Do Not Use' ||
      c.do_not_use === true

    const reasons = reds.map((f) => f.text)

    // Transition to Pending Review only if not already in a review state.
    if (!alreadyPending) {
      await supabaseAdmin
        .from('carriers')
        .update({ carrier_status: 'Pending Review' })
        .eq('dot_number', params.dot)
    }

    // Always document the ELD reason (deduped by the guard above).
    await supabaseAdmin.from('carrier_delta_log').insert([
      {
        dot_number: params.dot,
        rmis_insured_id: c.rmis_insured_id ?? null,
        change_summary: [ELD_MARKER],
        flags_detected: reasons,
        previous_operating_status: c.carrier_status ?? null,
        new_operating_status: alreadyPending
          ? c.carrier_status ?? null
          : 'Pending Review',
        alert_sent: false,
        processed: false,
      } as any,
    ])

    // Best-effort email alert.
    try {
      await sendComplianceAlert(
        [
          {
            dotNumber: params.dot,
            legalName: c.legal_name ?? params.dot,
            flags: reasons,
            alertType: 'delta_flag',
          },
        ],
        'ELD fraud signal'
      )
    } catch {
      /* mail failure is non-fatal */
    }

    return { flagged: true, transitioned: !alreadyPending }
  } catch {
    return { flagged: false, transitioned: false }
  }
}
