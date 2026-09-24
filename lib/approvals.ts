// Shared shape of an approval-queue row as returned by /api/approvals.
export interface ApprovalRequestRow {
  id: string
  dot_number: string
  vetting_record_id: string | null
  requested_status: 'Approved' | 'Exception Approved'
  required_level: 'manager' | 'director'
  requested_by: string
  requested_at: string
  request_note: string | null
  decision: 'approved' | 'sent_back' | null
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  carrier: {
    legal_name: string | null
    dba_name: string | null
    mc_number: string | null
    city: string | null
    state: string | null
    carrier_status: string | null
    safety_rating: string | null
    brokerware_status: string | null
    last_hauled_at: string | null
  } | null
  gap_score: number | null
  flagged_scores: string[] | null
  hard_stops: string[] | null
  exception_note: string | null
  internal_notes: string | null
  reviewed_by: string | null
}
