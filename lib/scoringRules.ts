export const GAP_THRESHOLD = 65
export const CATEGORY_THRESHOLD = 65

export const CATEGORY_FIELDS = [
  { key: 'crash_score', label: 'Crash Score' },
  { key: 'violation_score', label: 'Violation Score' },
  { key: 'csa_basics_score', label: 'CSA Basics Score' },
  { key: 'driver_oos_score', label: 'Driver OOS Score' },
  { key: 'critical_acute_violation_score', label: 'Critical Acute Violation Score' },
] as const

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

export function evaluateScores(scores: Record<string, number>): ScoreEvaluation {
  const gapScore = scores.gap_score ?? 0
  const flaggedCategories: string[] = []

  for (const field of CATEGORY_FIELDS) {
    const val = scores[field.key]
    if (val !== undefined && val !== null && val <= CATEGORY_THRESHOLD) {
      flaggedCategories.push(field.label)
    }
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
  } else if (gapScore >= 60 && gapScore < GAP_THRESHOLD) {
    approvalLevel = 'manager_exception'
    summary = `GAP score ${gapScore} requires documented manager exception`
  } else {
    approvalLevel = 'owner_exception'
    summary = `GAP score ${gapScore} is below 60 — owner-reviewed exception required`
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
    owner_exception: 'Owner Exception',
  }
  return labels[level]
}
