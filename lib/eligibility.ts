import { computeRevetStatus, isBrokerwareDisabled } from './revet'
import { exceptionState } from './exceptions'

// The one place that says whether a carrier may be tendered a load. Used by the
// tender-exception report and the pre-tender check so dispatch, the digest and
// the audit trail apply exactly the same rule.
//
// Deliberately narrow. A deviation is a SUBSTANTIVE problem only: a hard stop
// (insurance, operating authority, SAFER, rating) with no live exception, a
// GAP score in the director-exception band, a Conditional / Unsatisfactory
// rating, the carrier disabled in the TMS, or an explicit do-not-use decision
// (Declined, On Hold, Do Not Use). A carrier that is simply still "Pending
// Review" in the portal, or whose re-vet date has slipped, is not a deviation
// — that is a paperwork state, and reporting it would manufacture a record of
// a problem that does not exist.

/** GAP below this is the owner/director exception band (§9.4). */
export const GAP_DEVIATION_THRESHOLD = 60

const NEVER_COVERED = [/out of service order/i, /operating authority/i, /not active in SAFER/i, /safety rating/i]

const DO_NOT_USE_STATUSES = new Set(['Declined', 'On Hold', 'Do Not Use', 'Suspended'])

export interface EligibilityInput {
  carrier_status: string | null
  do_not_use: boolean | null
  brokerware_status: string | null
  safety_rating: string | null
  gap_score: number | null
  hard_stops: string[] | null
  /** Re-vet clock inputs; an exception lives as long as the re-vet. */
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

  const rv = computeRevetStatus(c.last_reviewed, c.created_at, c.revet_interval_days, c.revet_due_override)
  const exception = exceptionState(c.carrier_status, rv.dueDate, now)
  const covered = exception === 'accepted'

  if (isBrokerwareDisabled(c.brokerware_status)) {
    reasons.push(`Disabled in Brokerware${c.brokerware_status ? ` (${c.brokerware_status})` : ''}`)
  }
  if (c.do_not_use) reasons.push('Marked Do Not Use')
  const status = c.carrier_status ?? ''
  if (DO_NOT_USE_STATUSES.has(status)) reasons.push(`Carrier is ${status}`)

  // Policy Section 2: true hard stops are never covered by an exception. Only
  // new authority (a Section 4 exception) and insurance not yet showing in RMIS
  // (Section 9 carriers onboarded on a certificate) can be.
  const absolute = hs.filter((h) => NEVER_COVERED.some((re) => re.test(h)))
  for (const h of absolute) reasons.push(`Open hard stop: ${h}`)
  const coverable = hs.filter((h) => !absolute.includes(h))
  if (coverable.length > 0 && !covered) {
    for (const h of coverable) reasons.push(`Open hard stop: ${h}`)
    if (exception === 'aged') reasons.push('Exception expired — re-vet overdue with RMIS still not updated')
  }
  const rating = (c.safety_rating ?? '').trim().toLowerCase()
  if ((rating === 'conditional' || rating === 'unsatisfactory') && !covered && !hs.some((h) => /safety rating/i.test(h))) {
    reasons.push(`Safety rating is ${c.safety_rating}`)
  }
  if (c.gap_score !== null && c.gap_score < GAP_DEVIATION_THRESHOLD && !covered) {
    reasons.push(`GAP score ${c.gap_score.toFixed(2)} is below ${GAP_DEVIATION_THRESHOLD}`)
  }
  return { eligible: reasons.length === 0, reasons, hardStops: hs, exception }
}
