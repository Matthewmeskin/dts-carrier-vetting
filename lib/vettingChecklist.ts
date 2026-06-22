export interface ChecklistStep {
  id: string
  label: string
  description: string
  policyRef: string
  required: boolean
  completed: boolean
  completedBy?: string
  completedAt?: string
  notes: string
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
        label: 'Verified active FMCSA operating authority',
        description: 'Confirm no out-of-service order and contract authority is active (A) in FMCSA SAFER. Check RMIS DOT section.',
        policyRef: 'Section 5, 6',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'safety_rating',
        label: 'Confirmed no Conditional or Unsatisfactory safety rating',
        description: 'Safety rating must not be Conditional or Unsatisfactory. Satisfactory or Unrated are eligible with full review.',
        policyRef: 'Section 5, 9',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'auto_liability',
        label: 'Verified auto liability insurance via RMIS ($1M+ minimum)',
        description: 'Auto coverage status must be Valid in RMIS with Combined Single Limit of at least $1,000,000. Confidence should be High.',
        policyRef: 'Section 5, 8',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'cargo_coverage',
        label: 'Verified cargo coverage via RMIS ($100K+ minimum)',
        description: 'Cargo status must be Valid in RMIS with at least $100,000 in coverage.',
        policyRef: 'Section 5, 8',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'gap_score',
        label: 'Confirmed overall Bluewire GAP Score ≥ 65',
        description: 'Review the GAP score from the most recent monthly Bluewire upload. Score must be 65.00 or higher to clear automatically.',
        policyRef: 'Section 9.2',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'category_scores',
        label: 'Confirmed all 5 safety category scores are above 65',
        description: 'Crash Score, Violation Score, CSA Basics Score, Driver OOS Score, and Critical Acute Violation Score must each individually be above 65. Any score at or below 65 requires additional vetting on the detail.',
        policyRef: 'Section 9.3',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'authority_age',
        label: 'Confirmed continuous authority age (365 days minimum or documented exception)',
        description: 'Check OriginalAuthorityGrantDate in RMIS. Less than 365 days requires documented exception. Less than 90 days requires senior approval and enhanced controls.',
        policyRef: 'Section 7',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'inspection_history',
        label: 'Reviewed roadside inspection history',
        description: 'Check total inspections, vehicle OOS ratio vs 22.26% national average, and driver OOS ratio vs 6.67% national average. Zero inspections requires exception review.',
        policyRef: 'Section 10',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'identity_verification',
        label: 'Verified carrier identity via FMCSA and OSINT',
        description: 'Confirm contact information matches FMCSA-reported data. No mismatched ownership, phone numbers, email domains, or documents.',
        policyRef: 'Section 11',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'fraud_indicators',
        label: 'No unresolved fraud, double-brokering, or identity concerns',
        description: 'No chameleon carrier signals, no cargo theft flags, no shared principals with DNU carriers, no suspicious contact changes.',
        policyRef: 'Section 11, 12',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'broker_carrier_agreement',
        label: 'Executed broker-carrier agreement on file in RMIS',
        description: 'Agreement must be executed and Agree = Yes in RMIS. Verify title and date.',
        policyRef: 'Section 6',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'w9',
        label: 'W-9 on file and payment information verified',
        description: 'W-9 must be on file. If carrier is factoring, NOA must be on file and pay-to entity must be verified against the NOA.',
        policyRef: 'Section 6, 17',
        required: true,
        completed: false,
        notes: '',
      },
      {
        id: 'general_liability',
        label: 'Reviewed general liability status (preferred: $1M/$2M)',
        description: '$1M per occurrence and $2M aggregate preferred. Not a hard stop if missing but should be noted if absent.',
        policyRef: 'Section 6, 8',
        required: false,
        completed: false,
        notes: '',
      },
      {
        id: 'exception_note',
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
