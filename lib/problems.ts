import { CarrierSummary } from './types'

// A "problem" is either a categorized hard stop or a flagged safety-score
// category. Hard-stop strings carry dynamic values (dollar amounts, day counts,
// statuses), so we bucket them into canonical categories by keyword; flagged
// scores are already clean labels and pass through as-is.

export type ProblemGroup = 'Hard Stop' | 'Flagged Score'

export interface Problem {
  key: string
  label: string
  group: ProblemGroup
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
  // Hard stops first, then flagged scores; within a group, most-common first.
  const groupOrder: Record<ProblemGroup, number> = {
    'Hard Stop': 0,
    'Flagged Score': 1,
  }
  return Array.from(map.values()).sort(
    (a, b) => groupOrder[a.group] - groupOrder[b.group] || b.count - a.count
  )
}
