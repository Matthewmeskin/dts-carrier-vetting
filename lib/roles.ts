// Role-based access control. Roles are hierarchical: staff < manager < director
// (director == owner; the two were merged). The gate is the vetting DECISION —
// approving a carrier that triggered an exception requires a high-enough role.

export type Role = 'staff' | 'manager' | 'director'
export type ApprovalLevel = 'none' | 'manager' | 'director'

export const ROLE_RANK: Record<Role, number> = { staff: 0, manager: 1, director: 2 }
export const APPROVAL_RANK: Record<ApprovalLevel, number> = {
  none: 0,
  manager: 1,
  director: 2,
}

export const ROLE_LABEL: Record<Role, string> = {
  staff: 'Staff',
  manager: 'Manager',
  director: 'Director',
}

export function isRole(v: unknown): v is Role {
  return v === 'staff' || v === 'manager' || v === 'director'
}

/** Carrier statuses that constitute an approval (subject to the role gate). */
export const APPROVING_STATUSES = ['Approved', 'Exception Approved']

/**
 * The minimum approval role a carrier needs, from its score-derived approval
 * level and safety rating. Policy (Oct 2026): only a director approves an
 * exception, so every non-clean score needs a director.
 *  - Unsatisfactory / Conditional rating → Director
 *  - GAP < 60 (owner_exception)           → Director
 *  - Any category below its threshold (additional_vetting) → Director
 *  - Legacy manager_exception rows        → Director
 *  - Clean (auto_clear)                   → none
 */
export function requiredApprovalLevel(
  scoreApprovalLevel: string | null | undefined,
  safetyRating?: string | null
): ApprovalLevel {
  const r = (safetyRating ?? '').trim().toLowerCase()
  if (r === 'unsatisfactory' || r === 'conditional') return 'director'
  switch (scoreApprovalLevel) {
    case 'owner_exception':
    case 'manager_exception':
    case 'additional_vetting':
      return 'director'
    default:
      return 'none'
  }
}

/** Whether a role may approve a carrier requiring the given level. */
export function roleCanApprove(
  role: Role | null | undefined,
  level: ApprovalLevel
): boolean {
  if (level === 'none') return !!role // any signed-in user can clear a clean carrier
  if (!role) return false
  return ROLE_RANK[role] >= APPROVAL_RANK[level]
}

/**
 * The level a status change actually needs. Exception Approved always needs a
 * director, whatever triggered the exception (scores, authority age,
 * inspections, or anything else outside the baseline).
 */
export function levelForStatus(status: string, level: ApprovalLevel): ApprovalLevel {
  return status === 'Exception Approved' ? 'director' : level
}

/** Whether `role` may set `status` on a carrier requiring `level`. */
export function roleCanSetStatus(
  role: Role | null | undefined,
  status: string,
  level: ApprovalLevel
): boolean {
  if (!role) return false
  // Declines / suspensions / holds are restrictive — any signed-in user may set.
  if (!APPROVING_STATUSES.includes(status)) return true
  return roleCanApprove(role, levelForStatus(status, level))
}
