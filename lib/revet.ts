import { differenceInDays, parseISO, isValid } from 'date-fns'

// Selectable re-vetting cadences (days). Policy default is 120.
export const REVET_INTERVAL_OPTIONS = [30, 60, 90, 120] as const
export type RevetInterval = (typeof REVET_INTERVAL_OPTIONS)[number]
export const DEFAULT_REVET_INTERVAL = 120

// Carriers within this many days of the due date are flagged "due soon".
export const REVET_DUE_SOON_WINDOW = 14

// Policy §4: a carrier that hasn't hauled for DTS within this many days is
// "dormant" — re-verify before reuse. Separate from the re-vet clock: hauling
// does NOT reset re-vetting (an active carrier still ages into scheduled review).
export const DORMANCY_DAYS = 120

export type RevetState = 'ok' | 'due_soon' | 'overdue' | 'unknown'

export interface HaulActivity {
  /** Most recent haul date, or null if we have no record of a haul for DTS. */
  lastHauledAt: string | null
  /** Whole days since the last haul, or null when never hauled/unknown. */
  daysSinceHauled: number | null
  /** True only for a carrier we HAVE used that has since gone quiet ≥ threshold.
   *  Never-hauled carriers are not "dormant" — that's a distinct state. */
  dormant: boolean
  label: string
}

/**
 * Compute a carrier's haul-activity state from its last haul date (Policy §4).
 * Never-hauled carriers return dormant=false with a "No haul on record" label so
 * a brand-new or never-used carrier isn't mislabeled as dormant.
 */
export function computeHaulActivity(
  lastHauledAt: string | null | undefined,
  thresholdDays: number = DORMANCY_DAYS
): HaulActivity {
  const at = toDate(lastHauledAt)
  if (!at) {
    return { lastHauledAt: null, daysSinceHauled: null, dormant: false, label: 'No haul on record' }
  }
  const days = differenceInDays(new Date(), at)
  // A future date means a load is booked ahead — clearly active, never dormant.
  if (days < 0) {
    return { lastHauledAt: at.toISOString(), daysSinceHauled: days, dormant: false, label: 'Load booked ahead' }
  }
  const dormant = days >= thresholdDays
  const label = dormant
    ? `Not hauled in ${days}d`
    : days === 0
      ? 'Hauled today'
      : `Last hauled ${days}d ago`
  return { lastHauledAt: at.toISOString(), daysSinceHauled: days, dormant, label }
}

/** A carrier is "disabled" when Brokerware reports a non-Active status. */
export function isBrokerwareDisabled(status: string | null | undefined): boolean {
  return (
    status != null &&
    status.trim() !== '' &&
    status.trim().toLowerCase() !== 'active'
  )
}

/** A carrier is "active" when Brokerware explicitly reports an Active status. */
export function isBrokerwareActive(status: string | null | undefined): boolean {
  return !!status && status.trim().toLowerCase() === 'active'
}

export interface RevetStatus {
  intervalDays: number
  dueDate: Date | null
  daysUntil: number | null
  state: RevetState
  /** Short label for a badge, e.g. "Re-vet due in 34d" / "Overdue by 12d". */
  label: string
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = parseISO(value)
  return isValid(d) ? d : null
}

/**
 * Compute a carrier's re-vet status. The clock starts at the last completed
 * vetting; for never-vetted carriers it starts at onboarding (created_at).
 */
export function computeRevetStatus(
  lastReviewed: string | null | undefined,
  createdAt: string | null | undefined,
  intervalDays: number | null | undefined
): RevetStatus {
  const interval = intervalDays ?? DEFAULT_REVET_INTERVAL
  const base = toDate(lastReviewed) ?? toDate(createdAt)
  if (!base) {
    return { intervalDays: interval, dueDate: null, daysUntil: null, state: 'unknown', label: 'No review date' }
  }
  const dueDate = new Date(base.getTime())
  dueDate.setDate(dueDate.getDate() + interval)
  const daysUntil = differenceInDays(dueDate, new Date())

  let state: RevetState
  if (daysUntil < 0) state = 'overdue'
  else if (daysUntil <= REVET_DUE_SOON_WINDOW) state = 'due_soon'
  else state = 'ok'

  const label =
    daysUntil < 0
      ? `Overdue by ${Math.abs(daysUntil)}d`
      : daysUntil === 0
        ? 'Re-vet due today'
        : `Re-vet due in ${daysUntil}d`

  return { intervalDays: interval, dueDate, daysUntil, state, label }
}
