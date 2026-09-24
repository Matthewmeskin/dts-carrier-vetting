import { APPROVING_STATUSES } from './roles'
import { computeRevetStatus, isBrokerwareDisabled } from './revet'
import { exceptionState } from './exceptions'

// The one place that says whether a carrier may be tendered a load under the
// selection policy. Used by the tender-exception report, the pre-tender check
// endpoint, and anything else that needs a yes/no with reasons — so dispatch,
// the digest and the audit trail all apply exactly the same rule.

export interface EligibilityInput {
  carrier_status: string | null
  do_not_use: boolean | null
  brokerware_status: string | null
  hard_stops: string[] | null
  /** Re-vet clock inputs; the exception (if any) lives as long as the re-vet. */
  last_reviewed: string | null
  created_at: string | null
  revet_interval_days: number | null
  revet_due_override: string | null
  is_intrastate?: boolean | null
}

export interface Eligibility {
  eligible: boolean
  reasons: string[]
  /** Open hard stops after the intrastate suppression, for display. */
  hardStops: string[]
  exception: 'none' | 'accepted' | 'aged'
}

export function evaluateEligibility(c: EligibilityInput, now: number = Date.now()): Eligibility {
  const reasons: string[] = []
  let hs = (c.hard_stops ?? []).filter(Boolean)
  if (c.is_intrastate) hs = hs.filter((h) => !/operating authority/i.test(h))

  if (isBrokerwareDisabled(c.brokerware_status)) {
    reasons.push(`Disabled in Brokerware${c.brokerware_status ? ` (${c.brokerware_status})` : ''}`)
  }
  if (c.do_not_use) reasons.push('Marked Do Not Use')
  const status = c.carrier_status ?? ''
  if (!APPROVING_STATUSES.includes(status)) {
    reasons.push(status ? `Vetting status is ${status}, not Approved` : 'Never vetted — no status')
  }
  const rv = computeRevetStatus(c.last_reviewed, c.created_at, c.revet_interval_days, c.revet_due_override)
  const exception = exceptionState(c.carrier_status, rv.dueDate, now)
  if (hs.length > 0 && exception !== 'accepted') {
    for (const h of hs) reasons.push(`Open hard stop: ${h}`)
    if (exception === 'aged') reasons.push('Exception expired — re-vet overdue with RMIS still not updated')
  }
  if (APPROVING_STATUSES.includes(status) && rv.state === 'overdue' && hs.length === 0) {
    reasons.push(`Re-vet overdue by ${Math.abs(rv.daysUntil ?? 0)} days`)
  }
  return { eligible: reasons.length === 0, reasons, hardStops: hs, exception }
}
