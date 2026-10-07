// Carrier ownership: which team member works each carrier's vetting, and the
// arithmetic for handing a roster out in bulk (even split, by letter range, or
// a fixed count each). Pure functions — shared by the API and the UI preview.

import type { Role } from './roles'

export interface TeamMember {
  id: string
  email: string | null
  full_name: string | null
  role: Role
}

export interface AssignmentInfo {
  assignee_id: string | null
  assignee_name: string | null
  assigned_at: string | null
}

/** A person's display name: full name, else the part of the email before @. */
export function memberName(m: { full_name?: string | null; email?: string | null } | null | undefined): string {
  if (!m) return 'Unassigned'
  const n = (m.full_name ?? '').trim()
  if (n) return n
  const e = (m.email ?? '').trim()
  return e ? e.split('@')[0] : 'Unknown'
}

/** Two-letter initials for a chip. */
export function memberInitials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Who may change a carrier's owner. Managers and directors assign anyone;
 *  staff may claim a carrier for themselves or release one they own. */
export function canAssign(
  role: Role,
  userId: string,
  currentAssignee: string | null,
  nextAssignee: string | null
): boolean {
  if (role === 'manager' || role === 'director') return true
  if (nextAssignee === userId) return true
  if (nextAssignee === null && currentAssignee === userId) return true
  return false
}

// ── Distribution ─────────────────────────────────────────────────────────────

export interface PoolCarrier {
  dot_number: string
  legal_name: string | null
}

/** Letters used for alphabet ranges: '#' for names starting with a digit, then A–Z. */
export const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')]

/** The sort key for a carrier name: upper-cased, leading junk stripped. */
export function nameKey(name: string | null | undefined): string {
  return (name ?? '').toUpperCase().replace(/^[^A-Z0-9]+/, '').trim()
}

/** Which letter bucket a carrier falls in ('#' for digits / empty). */
export function letterOf(name: string | null | undefined): string {
  const k = nameKey(name)
  const ch = k.charAt(0)
  return /[A-Z]/.test(ch) ? ch : '#'
}

export function sortPool<T extends PoolCarrier>(pool: T[]): T[] {
  return [...pool].sort((a, b) => {
    const ka = nameKey(a.legal_name)
    const kb = nameKey(b.legal_name)
    if (ka !== kb) return ka < kb ? -1 : 1
    return a.dot_number < b.dot_number ? -1 : 1
  })
}

export function letterHistogram(pool: PoolCarrier[]): Record<string, number> {
  const h: Record<string, number> = {}
  for (const l of LETTERS) h[l] = 0
  for (const c of pool) h[letterOf(c.legal_name)] += 1
  return h
}

export interface LetterRange {
  assigneeId: string
  from: string
  to: string
}

export type DistributeMethod = 'even' | 'count' | 'alphabet'

export interface DistributeOptions {
  method: DistributeMethod
  /** People receiving carriers, in order. */
  assignees: string[]
  /** For 'count': how many each person gets. */
  count?: number
  /** For 'alphabet': one range per person (inclusive letters). */
  ranges?: LetterRange[]
}

export interface PlanBucket {
  assigneeId: string
  dots: string[]
  first: string | null
  last: string | null
  letters: string
}

export interface DistributionPlan {
  total: number
  assigned: number
  leftover: number
  buckets: PlanBucket[]
}

function lettersLabel(from: string, to: string): string {
  return from === to ? from : `${from}–${to}`
}

function bucketOf(assigneeId: string, rows: PoolCarrier[]): PlanBucket {
  const sorted = sortPool(rows)
  const first = sorted[0]?.legal_name ?? null
  const last = sorted[sorted.length - 1]?.legal_name ?? null
  const letters =
    sorted.length === 0
      ? '—'
      : lettersLabel(letterOf(sorted[0].legal_name), letterOf(sorted[sorted.length - 1].legal_name))
  return { assigneeId, dots: sorted.map((c) => c.dot_number), first, last, letters }
}

/**
 * Work out who gets what. Every method hands out contiguous alphabetical
 * blocks, so each person ends up with a letter-shaped slice of the roster
 * rather than a random scatter — easier to remember and to split later.
 */
export function planDistribution(pool: PoolCarrier[], opts: DistributeOptions): DistributionPlan {
  const sorted = sortPool(pool)
  const people = opts.assignees.filter((id, i, arr) => id && arr.indexOf(id) === i)
  const buckets: PlanBucket[] = []

  if (people.length === 0 || sorted.length === 0) {
    return { total: sorted.length, assigned: 0, leftover: sorted.length, buckets: people.map((p) => bucketOf(p, [])) }
  }

  if (opts.method === 'alphabet') {
    const ranges = (opts.ranges ?? []).filter((r) => people.includes(r.assigneeId))
    const used = new Set<string>()
    for (const p of people) {
      const mine = ranges.filter((r) => r.assigneeId === p)
      const rows = sorted.filter((c) => {
        if (used.has(c.dot_number)) return false
        const l = letterOf(c.legal_name)
        const li = LETTERS.indexOf(l)
        return mine.some((r) => {
          const a = LETTERS.indexOf(r.from.toUpperCase())
          const b = LETTERS.indexOf(r.to.toUpperCase())
          if (a < 0 || b < 0) return false
          return li >= Math.min(a, b) && li <= Math.max(a, b)
        })
      })
      for (const c of rows) used.add(c.dot_number)
      buckets.push(bucketOf(p, rows))
    }
  } else {
    // 'even': equal contiguous blocks; 'count': N each in order, rest left over.
    const per =
      opts.method === 'count'
        ? Math.max(0, Math.floor(opts.count ?? 0))
        : Math.ceil(sorted.length / people.length)
    let cursor = 0
    for (let i = 0; i < people.length; i++) {
      // Even split: spread the remainder so sizes differ by at most one.
      let size = per
      if (opts.method === 'even') {
        const base = Math.floor(sorted.length / people.length)
        const extra = sorted.length % people.length
        size = base + (i < extra ? 1 : 0)
      }
      const rows = sorted.slice(cursor, cursor + size)
      cursor += rows.length
      buckets.push(bucketOf(people[i], rows))
    }
  }

  const assigned = buckets.reduce((n, b) => n + b.dots.length, 0)
  return { total: sorted.length, assigned, leftover: sorted.length - assigned, buckets }
}

/**
 * Suggest balanced letter ranges for N people from a letter histogram: walk
 * the alphabet and cut whenever a person has reached their fair share.
 */
export function suggestLetterRanges(histogram: Record<string, number>, n: number): Array<{ from: string; to: string }> {
  const total = LETTERS.reduce((s, l) => s + (histogram[l] ?? 0), 0)
  if (n <= 0) return []
  if (n === 1) return [{ from: LETTERS[0], to: LETTERS[LETTERS.length - 1] }]
  const target = total / n
  const out: Array<{ from: string; to: string }> = []
  let start = 0
  let acc = 0
  for (let i = 0; i < LETTERS.length; i++) {
    acc += histogram[LETTERS[i]] ?? 0
    const lettersLeft = LETTERS.length - i - 1
    const peopleLeft = n - out.length - 1
    // Cut here if we've reached the share, or we must leave letters for the rest.
    if ((acc >= target && peopleLeft > 0) || lettersLeft === peopleLeft) {
      if (peopleLeft > 0) {
        out.push({ from: LETTERS[start], to: LETTERS[i] })
        start = i + 1
        acc = 0
      }
    }
    if (out.length === n - 1) break
  }
  out.push({ from: LETTERS[Math.min(start, LETTERS.length - 1)], to: LETTERS[LETTERS.length - 1] })
  return out.slice(0, n)
}
