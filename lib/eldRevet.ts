// Auto-flag a carrier for re-vetting when a live ELD pull produces strong
// (red-level) fleet-integrity fraud signals. Best-effort and idempotent: it
// transitions the carrier to "Pending Review" only once and logs a change entry
// for the audit trail, so repeated polls don't spam the log.

import { supabaseAdmin } from './supabase'
import { isBrokerwareDisabled } from './revet'
import { sendComplianceAlert } from './emailAlerts'
import type { EldFleetAnalysis } from './eldAnalysis'

export async function maybeFlagForRevet(params: {
  dot: string
  analysis: EldFleetAnalysis
}): Promise<{ flagged: boolean; reason?: string }> {
  const reds = params.analysis.flags.filter((f) => f.level === 'red')
  if (reds.length === 0) return { flagged: false }

  try {
    const { data: carrier } = await supabaseAdmin
      .from('carriers')
      .select(
        'id, dot_number, legal_name, carrier_status, do_not_use, brokerware_status, rmis_insured_id'
      )
      .eq('dot_number', params.dot)
      .single()
    if (!carrier) return { flagged: false }
    const c: any = carrier

    // Don't churn carriers that are disabled, already in review, or already
    // do-not-use — they don't need (another) re-vet nudge.
    if (isBrokerwareDisabled(c.brokerware_status)) return { flagged: false }
    if (
      c.carrier_status === 'Pending Review' ||
      c.carrier_status === 'Do Not Use' ||
      c.do_not_use === true
    ) {
      return { flagged: false }
    }

    const reasons = reds.map((f) => f.text)

    // Transition to Pending Review so it surfaces in the "Needs Review" filter.
    await supabaseAdmin
      .from('carriers')
      .update({ carrier_status: 'Pending Review' })
      .eq('dot_number', params.dot)

    // Record the reason in the change history (audit trail + Changes page).
    await supabaseAdmin.from('carrier_delta_log').insert([
      {
        dot_number: params.dot,
        rmis_insured_id: c.rmis_insured_id ?? null,
        change_summary: [
          'ELD fleet-integrity fraud signal — auto-flagged for re-vet',
        ],
        flags_detected: reasons,
        previous_operating_status: c.carrier_status ?? null,
        new_operating_status: 'Pending Review',
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

    return { flagged: true, reason: reasons.join(' · ') }
  } catch {
    return { flagged: false }
  }
}
