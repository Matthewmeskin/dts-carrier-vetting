// Exception-approved hard stops: one definition of "accepted" vs "expired",
// shared by the carriers table, the carrier page and the daily digest so all
// three flip on the same day.
//
// An exception lasts exactly as long as the carrier's current vetting: it is
// accepted until the carrier's re-vet comes due, and expires the day the re-vet
// is overdue. Set the re-vet cadence to 60 days and the exception is good for
// 60 days; set a specific due date and the exception ends on that date. There
// is no separate exception clock to drift out of step with the re-vet clock.

export type ExceptionState = 'none' | 'accepted' | 'aged'

/** Whole days since an ISO timestamp, or null when unknown. */
export function daysSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  const ms = iso ? Date.parse(iso) : NaN
  return Number.isFinite(ms) ? Math.max(0, Math.floor((now - ms) / 86_400_000)) : null
}

/** Where an open hard stop stands for this carrier.
 *  - 'none': not exception-approved — a plain open stop.
 *  - 'accepted': exception-approved and the re-vet is not yet due (or the due
 *    date is unknown; missing data never escalates on its own).
 *  - 'aged': exception-approved but the re-vet is overdue and RMIS still
 *    carries the stop, so it goes back to needs-action. */
export function exceptionState(
  carrierStatus: string | null | undefined,
  revetDueDate: Date | null | undefined,
  now: number = Date.now()
): ExceptionState {
  if (carrierStatus !== 'Exception Approved') return 'none'
  if (!revetDueDate || Number.isNaN(revetDueDate.getTime())) return 'accepted'
  return revetDueDate.getTime() < now ? 'aged' : 'accepted'
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
