// Policy (updated Oct 2026): a carrier clears automatically when the overall
// GAP score is 60 or higher AND every safety category score is 30 or higher.
// Before this the GAP bar was 65, four categories had to be a perfect 100,
// and GAP 60–64.99 was a manager exception.
export const GAP_THRESHOLD = 60
// Every gating category passes at or above 30.
export const MIN_30_THRESHOLD = 30
// Kept for the 'perfect' requirement type (no field uses it under the
// current policy).
export const PERFECT_SCORE = 100

export type ScoreRequirement = 'min30' | 'perfect' | 'ignored'

export interface ScoreFieldDef {
  key: string
  label: string
  requirement: ScoreRequirement
}

// The full set of component scores and how each one gates approval:
//  - min30:   must be >= 30 (every safety category)
//  - perfect: must be 100   (no longer used by policy; kept for old rows)
//  - ignored: shown for context only, never gates (Judicial Hellholes)
export const SCORE_FIELDS: ScoreFieldDef[] = [
  { key: 'crash_score', label: 'Crash Score', requirement: 'min30' },
  { key: 'violation_score', label: 'Violation Score', requirement: 'min30' },
  { key: 'csa_basics_score', label: 'CSA Basics Score', requirement: 'min30' },
  { key: 'driver_oos_score', label: 'Driver OOS Score', requirement: 'min30' },
  { key: 'critical_acute_violation_score', label: 'Critical/Acute Violation Score', requirement: 'min30' },
  { key: 'new_entrant_score', label: 'New Entrant Score', requirement: 'min30' },
  { key: 'mcs_150_score', label: 'MCS-150 Score', requirement: 'min30' },
  { key: 'safety_rating_score', label: 'Safety Rating Score', requirement: 'min30' },
  { key: 'judicial_hellholes_score', label: 'Judicial Hellholes Score', requirement: 'ignored' },
]

// Scores that actually gate approval (everything except the ignored ones).
export const GATING_FIELDS = SCORE_FIELDS.filter((f) => f.requirement !== 'ignored')

/**
 * Whether a single score value satisfies its requirement.
 * Returns null when the score isn't present or the field is ignored.
 */
export function scoreFieldPasses(
  key: string,
  val: number | null | undefined
): boolean | null {
  if (val === null || val === undefined) return null
  const def = SCORE_FIELDS.find((f) => f.key === key)
  if (!def || def.requirement === 'ignored') return null
  if (def.requirement === 'perfect') return val >= PERFECT_SCORE
  return val >= MIN_30_THRESHOLD
}

export type ApprovalLevel =
  | 'auto_clear'
  | 'additional_vetting'
  | 'manager_exception'
  | 'owner_exception'

export interface ScoreEvaluation {
  overallPass: boolean
  requiresRevetting: boolean
  flaggedCategories: string[]
  approvalLevel: ApprovalLevel
  gapScore: number
  summary: string
}

export function evaluateScores(
  scores: Record<string, number | null | undefined>
): ScoreEvaluation {
  const gapScore = scores.gap_score ?? 0
  const flaggedCategories: string[] = []

  for (const f of GATING_FIELDS) {
    const val = scores[f.key]
    if (val === undefined || val === null) continue
    if (scoreFieldPasses(f.key, val) === false) flaggedCategories.push(f.label)
  }

  const gapPasses = gapScore >= GAP_THRESHOLD
  const categoriesPass = flaggedCategories.length === 0
  const overallPass = gapPasses && categoriesPass
  const requiresRevetting = !overallPass

  let approvalLevel: ApprovalLevel
  let summary: string

  if (gapScore >= GAP_THRESHOLD && categoriesPass) {
    approvalLevel = 'auto_clear'
    summary = 'Clears automatically — no additional review required'
  } else if (gapScore >= GAP_THRESHOLD && !categoriesPass) {
    approvalLevel = 'additional_vetting'
    summary = `GAP score clears but ${flaggedCategories.length} category score(s) require additional vetting: ${flaggedCategories.join(', ')}`
  } else {
    // Below the GAP bar. (The former manager band, GAP 60–64.99, now clears;
    // 'manager_exception' survives in the type only for rows scored before.)
    approvalLevel = 'owner_exception'
    summary = `GAP score ${gapScore} is below ${GAP_THRESHOLD} — director-reviewed exception required`
  }

  return {
    overallPass,
    requiresRevetting,
    flaggedCategories,
    approvalLevel,
    gapScore,
    summary,
  }
}

export function getApprovalLevelLabel(level: ApprovalLevel): string {
  const labels: Record<ApprovalLevel, string> = {
    auto_clear: 'Auto Clear',
    additional_vetting: 'Additional Vetting Required',
    manager_exception: 'Manager Exception',
    owner_exception: 'Director Exception',
  }
  return labels[level]
}
