// Exception-approved hard stops: one definition of "accepted" vs "aged", shared
// by the carriers table, the carrier page and the daily digest so all three
// agree on the day a carrier flips from amber back to red.

/** An Exception Approved carrier whose RMIS record still carries the hard stop
 *  after this many days is escalated back to needs-action. */
export const EXCEPTION_MAX_DAYS = 30

export type ExceptionState = 'none' | 'accepted' | 'aged'

/** Whole days since an ISO timestamp, or null when unknown. */
export function daysSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  const ms = iso ? Date.parse(iso) : NaN
  return Number.isFinite(ms) ? Math.max(0, Math.floor((now - ms) / 86_400_000)) : null
}

/** Where an open hard stop stands for this carrier.
 *  - 'none': not exception-approved — a plain open stop.
 *  - 'accepted': exception-approved within the window (or with no recorded
 *    sign-off date; missing data never escalates on its own).
 *  - 'aged': exception-approved more than EXCEPTION_MAX_DAYS ago and RMIS still
 *    hasn't caught up, so it goes back to needs-action. */
export function exceptionState(
  carrierStatus: string | null | undefined,
  exceptionSince: string | null | undefined,
  now: number = Date.now()
): ExceptionState {
  if (carrierStatus !== 'Exception Approved') return 'none'
  const d = daysSince(exceptionSince, now)
  return d !== null && d > EXCEPTION_MAX_DAYS ? 'aged' : 'accepted'
}

/** Whether an activity-log event records the carrier being set to Exception
 *  Approved — either an explicit status change or a vetting save that set it. */
export function eventSetsException(e: {
  detail?: { carrier_status?: unknown; changes?: unknown } | null
}): boolean {
  const d = e.detail
  if (!d) return false
  if (d.carrier_status === 'Exception Approved') return true
  return Array.isArray(d.changes) && d.changes.some((ch) => String(ch).includes('Exception Approved'))
}
