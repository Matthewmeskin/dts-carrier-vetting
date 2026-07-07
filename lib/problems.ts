import { CarrierSummary } from './types'

// A "problem" is either a categorized hard stop or a flagged safety-score
// category. Hard-stop strings carry dynamic values (dollar amounts, day counts,
// statuses), so we bucket them into canonical categories by keyword; flagged
// scores are already clean labels and pass through as-is.

export type ProblemGroup = 'Hard Stop' | 'Insurance' | 'Flagged Score'

export interface Problem {
  key: string
  label: string
  group: ProblemGroup
}

// Coverage within this many days of its expiration date counts as "expiring
// soon" — the renewal watch list. Kept in sync with the evaluator's flag window.
export const COVERAGE_EXPIRING_SOON_DAYS = 30

/** Whole days from today (UTC) until a plain date string, or null if invalid. */
function daysUntilDate(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const t = Date.parse(dateStr)
  if (Number.isNaN(t)) return null
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  return Math.floor((t - Date.now()) / MS_PER_DAY)
}

// Synthetic insurance problems derived from the coverage expiration dates, so a
// carrier whose auto/cargo policy has expired or is about to lapse can be pulled
// up as a renewal list — independent of the categorized hard stops.
function insuranceProblems(c: CarrierSummary): Problem[] {
  const out: Problem[] = []
  const auto = daysUntilDate(c.auto_expiration_date)
  const cargo = daysUntilDate(c.cargo_expiration_date)
  const days = [auto, cargo].filter((d): d is number => d !== null)
  if (days.length === 0) return out
  const min = Math.min(...days)
  if (min < 0) {
    out.push({ key: 'ins:expired', label: 'Insurance expired', group: 'Insurance' })
  } else if (min <= COVERAGE_EXPIRING_SOON_DAYS) {
    out.push({
      key: 'ins:expiring',
      label: `Insurance expiring within ${COVERAGE_EXPIRING_SOON_DAYS} days`,
      group: 'Insurance',
    })
  }
  return out
}

const HARD_STOP_CATEGORIES: {
  key: string
  label: string
  test: RegExp
}[] = [
  { key: 'hs:authority', label: 'No active operating authority', test: /operating authority/i },
  { key: 'hs:safer', label: 'Not active in SAFER', test: /SAFER/i },
  { key: 'hs:rating', label: 'Unsatisfactory / Conditional safety rating', test: /safety rating/i },
  { key: 'hs:auto', label: 'Auto liability invalid / below minimum', test: /auto liability/i },
  { key: 'hs:cargo', label: 'Cargo invalid / below minimum', test: /cargo/i },
  { key: 'hs:new_authority', label: 'Authority under 90 days old', test: /days old/i },
]

const HS_OTHER: Problem = { key: 'hs:other', label: 'Other hard stop', group: 'Hard Stop' }

function categorizeHardStop(s: string): Problem {
  const m = HARD_STOP_CATEGORIES.find((c) => c.test.test(s))
  return m ? { key: m.key, label: m.label, group: 'Hard Stop' } : HS_OTHER
}

/** All distinct problems a carrier has (deduped), across hard stops + flags. */
export function carrierProblems(c: CarrierSummary): Problem[] {
  const byKey = new Map<string, Problem>()
  for (const hs of c.hard_stops ?? []) {
    const p = categorizeHardStop(hs)
    byKey.set(p.key, p)
  }
  for (const p of insuranceProblems(c)) {
    byKey.set(p.key, p)
  }
  for (const label of c.flagged_scores ?? []) {
    const key = `fs:${label}`
    byKey.set(key, { key, label, group: 'Flagged Score' })
  }
  return Array.from(byKey.values())
}

export interface ProblemFacet extends Problem {
  count: number
}

/** Count how many carriers in `rows` have each problem. */
export function problemFacets(rows: CarrierSummary[]): ProblemFacet[] {
  const map = new Map<string, ProblemFacet>()
  for (const c of rows) {
    for (const p of carrierProblems(c)) {
      const e = map.get(p.key)
      if (e) e.count++
      else map.set(p.key, { ...p, count: 1 })
    }
  }
  // Hard stops first, then insurance renewals, then flagged scores; within a
  // group, most-common first.
  const groupOrder: Record<ProblemGroup, number> = {
    'Hard Stop': 0,
    'Insurance': 1,
    'Flagged Score': 2,
  }
  return Array.from(map.values()).sort(
    (a, b) => groupOrder[a.group] - groupOrder[b.group] || b.count - a.count
  )
}
