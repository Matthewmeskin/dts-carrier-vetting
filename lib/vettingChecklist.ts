import type { InsuranceRecord, ScoreRecord } from './types'
import { formatCurrency, formatDate, formatScore, daysSince } from './utils'
import {
  GATING_FIELDS,
  scoreFieldPasses,
  MIN_30_THRESHOLD,
  PERFECT_SCORE,
  GAP_THRESHOLD,
} from './scoringRules'

export type AutoStatus = 'pass' | 'fail' | null

// CAVRA Standard pillars (Carrier Assessment, Verification, Risk, Accountability)
// used to group the vetting checklist.
export type ChecklistCategory =
  | 'assessment'
  | 'verification'
  | 'risk'
  | 'accountability'

export const CHECKLIST_CATEGORIES: {
  key: ChecklistCategory
  label: string
  description: string
}[] = [
  {
    key: 'assessment',
    label: 'Carrier Assessment',
    description: 'Safety performance — Bluewire scores, rating, inspection history',
  },
  {
    key: 'verification',
    label: 'Verification',
    description: 'Authority, insurance, identity, and required documents',
  },
  {
    key: 'risk',
    label: 'Risk',
    description: 'Authority maturity, fraud, double-brokering, and identity risk',
  },
  {
    key: 'accountability',
    label: 'Accountability',
    description: 'Exception documentation and approvals',
  },
]

export interface ChecklistStep {
  id: string
  label: string
  description: string
  policyRef: string
  category: ChecklistCategory
  required: boolean
  completed: boolean
  completedBy?: string
  completedAt?: string
  notes: string
  /** Policy result computed from RMIS / Bluewire data, or null when not data-derivable. */
  autoStatus?: AutoStatus
  /** Human-readable evidence backing the auto evaluation (shown inline). */
  evidence?: string
  /** Provenance of the current checked state. */
  source?: 'auto' | 'manual'
}

export interface VettingChecklist {
  steps: ChecklistStep[]
  exceptionNoteRequired: boolean
  exceptionNote: string
  finalStatus: string | null
  reviewedBy: string | null
  reviewedAt: string | null
}

export const EXCEPTION_NOTE_TEMPLATE = `Carrier: [CARRIER NAME], DOT [DOT NUMBER]
Date: [DATE]
Reviewed by: [YOUR NAME / ROLE]

Issue(s) identified:
[Describe the specific non-hard-stop issue — e.g., "Carrier has 45 days of authority and limited inspection history"]

Information reviewed:
[List what was checked — Bluewire scores, RMIS, FMCSA, OSINT, direct carrier conversation, etc.]

Mitigating factors:
[Describe why this carrier is still appropriate despite the issue — prior experience, low-risk freight, strong insurance, etc.]

Operational controls required:
[List controls — one-load limit, live ELD tracking, direct insurance verification, pickup verification, etc.]

Approval:
Approved for: [Scope — one load / specific lane / specific date range]
Approved by: [Name, Title]
Date: [Date]`

export function createDefaultChecklist(): VettingChecklist {
  return {
    steps: [
      {
        id: 'authority_active',
        category: 'verification',
        label: 'Verified active FMCSA operating authority',
        description: 'Confirm no out-of-service order and contract authority is active (A) in FMCSA SAFER. Check RMIS DOT section.',
        policyRef: 'Section 5, 6',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'safety_rating',
        category: 'assessment',
        label: 'Confirmed no Conditional or Unsatisfactory safety rating',
        description: 'Safety rating must not be Conditional or Unsatisfactory. Satisfactory or Unrated are eligible with full review.',
        policyRef: 'Section 5, 9',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'auto_liability',
        category: 'verification',
        label: 'Verified auto liability insurance via RMIS ($1M+ minimum)',
        description: 'Auto coverage status must be Valid in RMIS with Combined Single Limit of at least $1,000,000. Confidence should be High.',
        policyRef: 'Section 5, 8',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'cargo_coverage',
        category: 'verification',
        label: 'Verified cargo coverage via RMIS ($100K+ minimum)',
        description: 'Cargo status must be Valid in RMIS with at least $100,000 in coverage.',
        policyRef: 'Section 5, 8',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'gap_score',
        category: 'assessment',
        label: 'Confirmed overall Bluewire GAP Score ≥ 65',
        description: 'Review the GAP score from the most recent monthly Bluewire upload. Score must be 65.00 or higher to clear automatically.',
        policyRef: 'Section 9.2',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'category_scores',
        category: 'assessment',
        label: 'Confirmed safety category scores meet thresholds',
        description: 'Crash, Violation, CSA Basics, and Driver OOS must be at or above 30. Critical/Acute Violation, New Entrant, MCS-150, and Safety Rating must be 100. Judicial Hellholes is not considered. Any failing score requires additional vetting.',
        policyRef: 'Section 9.3',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'authority_age',
        category: 'risk',
        label: 'Confirmed continuous authority age (365 days minimum or documented exception)',
        description: 'Check OriginalAuthorityGrantDate in RMIS. Less than 365 days requires documented exception. Less than 90 days requires senior approval and enhanced controls.',
        policyRef: 'Section 7',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'inspection_history',
        category: 'assessment',
        label: 'Reviewed roadside inspection history',
        description: 'Confirm the carrier has roadside inspections on record. Zero inspections requires exception review. (Out-of-service performance is already captured by the Bluewire safety scores.)',
        policyRef: 'Section 10',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'identity_verification',
        category: 'verification',
        label: 'Verified carrier identity via FMCSA and OSINT',
        description: 'Confirm contact information matches FMCSA-reported data. No mismatched ownership, phone numbers, email domains, or documents.',
        policyRef: 'Section 11',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'fraud_indicators',
        category: 'risk',
        label: 'No unresolved fraud, double-brokering, or identity concerns',
        description: 'No chameleon carrier signals, no cargo theft flags, no shared principals with DNU carriers, no suspicious contact changes.',
        policyRef: 'Section 11, 12',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'broker_carrier_agreement',
        category: 'verification',
        label: 'Executed broker-carrier agreement on file in RMIS',
        description: 'Agreement must be executed and Agree = Yes in RMIS. Verify title and date.',
        policyRef: 'Section 6',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'w9',
        category: 'verification',
        label: 'W-9 on file and payment information verified',
        description: 'W-9 must be on file. If carrier is factoring, NOA must be on file and pay-to entity must be verified against the NOA.',
        policyRef: 'Section 6, 17',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'general_liability',
        category: 'verification',
        label: 'Reviewed general liability status (preferred: $1M/$2M)',
        description: '$1M per occurrence and $2M aggregate preferred. Not a hard stop if missing but should be noted if absent.',
        policyRef: 'Section 6, 8',
        required: false,
        completed: false,
        notes: '',
      },
      {
        id: 'exception_note',
        category: 'accountability',
        label: 'Exception note documented (if any non-hard-stop issue exists)',
        description: 'Complete the exception note below if any baseline preference is not satisfied. Identify the issue, review performed, mitigating factors, controls required, and approver.',
        policyRef: 'Section 16',
        required: false,
        completed: false,
        notes: '',
      },
    ],
    exceptionNoteRequired: false,
    exceptionNote: '',
    finalStatus: null,
    reviewedBy: null,
    reviewedAt: null,
  }
}

export function checklistCompletionPercent(checklist: VettingChecklist): number {
  const required = checklist.steps.filter(s => s.required)
  const completed = required.filter(s => s.completed)
  return required.length > 0 ? Math.round((completed.length / required.length) * 100) : 0
}

export function checklistIsComplete(checklist: VettingChecklist): boolean {
  return checklist.steps.filter(s => s.required).every(s => s.completed)
}

// ---------------------------------------------------------------------------
// Auto-evaluation — pre-fills checklist steps from RMIS + Bluewire data so the
// reviewer only does real work on the human-judgment items. Thresholds mirror
// scoringRules.ts and the RMIS policy so the checklist stays consistent.
// ---------------------------------------------------------------------------

export const AUTO_AUTO_LIABILITY_MIN = 1_000_000
export const AUTO_CARGO_MIN = 100_000
export const AUTO_AUTHORITY_MIN_DAYS = 365
export const AUTO_GL_OCCURRENCE_PREFERRED = 1_000_000
export const AUTO_GL_AGGREGATE_PREFERRED = 2_000_000

export interface ChecklistAutoInputs {
  safetyRating?: string | null
  insurance?: InsuranceRecord | null
  score?: ScoreRecord | null
}

interface StepEval {
  status: AutoStatus
  evidence: string
}

function isActiveStatus(s: string | null | undefined): boolean {
  if (!s) return false
  const v = s.trim().toLowerCase()
  return v === 'active' || v === 'valid' || v === 'a'
}

function computeAutoEvaluations(
  inputs: ChecklistAutoInputs
): Record<string, StepEval> {
  const ins = inputs.insurance ?? null
  const score = inputs.score ?? null
  const out: Record<string, StepEval> = {}

  // Active FMCSA operating authority. A carrier may run on common OR contract
  // authority (or both) — any active authority satisfies the requirement.
  if (
    ins &&
    (ins.operating_status ||
      ins.common_authority_status ||
      ins.contract_authority_status)
  ) {
    const opActive = isActiveStatus(ins.operating_status)
    const authTypes: string[] = []
    if (ins.common_authority_status === 'A') authTypes.push('Common')
    if (ins.contract_authority_status === 'A') authTypes.push('Contract')
    if (ins.broker_authority_status === 'A') authTypes.push('Broker')
    // If we have no authority columns at all, don't fail on their absence.
    const haveAuthorityData =
      ins.common_authority_status != null ||
      ins.contract_authority_status != null ||
      ins.broker_authority_status != null
    const authActive = authTypes.length > 0 || !haveAuthorityData
    out.authority_active = {
      status: opActive && authActive ? 'pass' : 'fail',
      evidence: `Operating: ${ins.operating_status ?? '—'} · Authority: ${
        authTypes.length > 0 ? authTypes.join(', ') : 'none active'
      }`,
    }
  }

  // Safety rating not Conditional / Unsatisfactory
  if (inputs.safetyRating !== undefined) {
    const r = (inputs.safetyRating || '').toLowerCase()
    const bad = r === 'conditional' || r === 'unsatisfactory'
    out.safety_rating = {
      status: bad ? 'fail' : 'pass',
      evidence: `Safety rating: ${inputs.safetyRating || 'Unrated'}`,
    }
  }

  // Auto liability ≥ $1M
  if (ins && (ins.auto_status || ins.auto_limit != null)) {
    const ok = isActiveStatus(ins.auto_status) && (ins.auto_limit ?? 0) >= AUTO_AUTO_LIABILITY_MIN
    out.auto_liability = {
      status: ok ? 'pass' : 'fail',
      evidence: `${formatCurrency(ins.auto_limit)} ${ins.auto_status ?? '—'}${ins.auto_expiration_date ? `, exp ${formatDate(ins.auto_expiration_date)}` : ''}`,
    }
  }

  // Cargo coverage ≥ $100K
  if (ins && (ins.cargo_status || ins.cargo_limit != null)) {
    const ok = isActiveStatus(ins.cargo_status) && (ins.cargo_limit ?? 0) >= AUTO_CARGO_MIN
    out.cargo_coverage = {
      status: ok ? 'pass' : 'fail',
      evidence: `${formatCurrency(ins.cargo_limit)} ${ins.cargo_status ?? '—'}${ins.cargo_expiration_date ? `, exp ${formatDate(ins.cargo_expiration_date)}` : ''}`,
    }
  }

  // Overall Bluewire GAP ≥ 65
  if (score && score.gap_score != null) {
    out.gap_score = {
      status: score.gap_score >= GAP_THRESHOLD ? 'pass' : 'fail',
      evidence: `GAP score ${formatScore(score.gap_score)} (threshold ${GAP_THRESHOLD})`,
    }
  }

  // Category scores meet their thresholds (≥30 for Crash/Violation/CSA/Driver
  // OOS, =100 for Critical-Acute/New Entrant/MCS-150/Safety Rating).
  if (score) {
    const failing: string[] = []
    let anyPresent = false
    for (const f of GATING_FIELDS) {
      const val = score[f.key as keyof ScoreRecord] as number | null | undefined
      if (val == null) continue
      anyPresent = true
      if (scoreFieldPasses(f.key, val) === false) {
        failing.push(`${f.label} ${formatScore(val)}`)
      }
    }
    if (anyPresent) {
      out.category_scores = {
        status: failing.length === 0 ? 'pass' : 'fail',
        evidence:
          failing.length === 0
            ? `All category scores meet thresholds (≥${MIN_30_THRESHOLD} / =${PERFECT_SCORE})`
            : `Failing: ${failing.join(', ')}`,
      }
    }
  }

  // Continuous authority age ≥ 365 days — from RMIS OriginalAuthorityGrantDate.
  // authority_days_active isn't stored, so fall back to the age computed from
  // the grant date, which we do store.
  const authDays =
    ins?.authority_days_active ?? daysSince(ins?.authority_original_date ?? null)
  if (ins && authDays != null) {
    const d = authDays
    const grant = ins.authority_original_date
      ? ` (granted ${formatDate(ins.authority_original_date)})`
      : ''
    out.authority_age = {
      status: d >= AUTO_AUTHORITY_MIN_DAYS ? 'pass' : 'fail',
      evidence:
        d >= AUTO_AUTHORITY_MIN_DAYS
          ? `Authority active ${d} days${grant}`
          : `Authority active ${d} days${grant} — under ${AUTO_AUTHORITY_MIN_DAYS}, documented exception required`,
    }
  }

  // Roadside inspection history reviewed
  if (ins && ins.us_total_inspections != null) {
    const n = ins.us_total_inspections
    out.inspection_history = {
      status: n > 0 ? 'pass' : 'fail',
      evidence:
        n > 0
          ? `${n} inspection(s) on record`
          : `Zero inspections on record — exception review required`,
    }
  }

  // Executed broker-carrier agreement on file
  if (ins && ins.broker_carrier_agreement_on_file != null) {
    const on = ins.broker_carrier_agreement_on_file
    out.broker_carrier_agreement = {
      status: on ? 'pass' : 'fail',
      evidence: on
        ? `On file in RMIS${ins.broker_carrier_agreement_date ? ` (${formatDate(ins.broker_carrier_agreement_date)})` : ''}`
        : `Not on file in RMIS`,
    }
  }

  // W-9 on file
  if (ins && ins.w9_on_file != null) {
    const on = ins.w9_on_file
    out.w9 = {
      status: on ? 'pass' : 'fail',
      evidence: `${on ? 'W-9 on file' : 'W-9 not on file'}${ins.is_factoring ? ' · factoring — verify NOA & pay-to' : ''}`,
    }
  }

  // General liability (optional, preferred $1M/$2M) — informational only
  if (ins && (ins.general_occurrence_limit != null || ins.general_aggregate_limit != null)) {
    const occ = ins.general_occurrence_limit ?? 0
    const agg = ins.general_aggregate_limit ?? 0
    const meetsPreferred =
      occ >= AUTO_GL_OCCURRENCE_PREFERRED && agg >= AUTO_GL_AGGREGATE_PREFERRED
    out.general_liability = {
      // Optional preference — only auto-check when it clears; never auto-fail.
      status: meetsPreferred ? 'pass' : null,
      evidence: `${formatCurrency(ins.general_occurrence_limit)} / ${formatCurrency(ins.general_aggregate_limit)}${meetsPreferred ? '' : ' (below preferred $1M/$2M)'}`,
    }
  }

  return out
}

/** Attach autoStatus + evidence to each step from the supplied data. */
export function attachAutoEvidence(
  checklist: VettingChecklist,
  inputs: ChecklistAutoInputs
): VettingChecklist {
  const evals = computeAutoEvaluations(inputs)
  return {
    ...checklist,
    steps: checklist.steps.map((s) => {
      const e = evals[s.id]
      return e ? { ...s, autoStatus: e.status, evidence: e.evidence } : s
    }),
  }
}

/** Pre-check the steps the data clears, marking their provenance as 'auto'. */
export function applyAutoCompletion(
  checklist: VettingChecklist
): VettingChecklist {
  return {
    ...checklist,
    steps: checklist.steps.map((s) =>
      s.autoStatus === 'pass'
        ? { ...s, completed: true, source: 'auto' }
        : s.autoStatus === 'fail'
          ? { ...s, completed: false, source: 'auto' }
          : s
    ),
  }
}

export interface AutoSummary {
  autoVerified: number
  failed: number
  manual: number
}

export function autoSummary(checklist: VettingChecklist): AutoSummary {
  let autoVerified = 0
  let failed = 0
  let manual = 0
  for (const s of checklist.steps) {
    if (s.autoStatus === 'pass') autoVerified++
    else if (s.autoStatus === 'fail') failed++
    else manual++
  }
  return { autoVerified, failed, manual }
}
