// Shared frontend types mirroring the API route response shapes.

export interface CarrierSummary {
  id: string
  dot_number: string
  mc_number: string | null
  legal_name: string | null
  dba_name: string | null
  city: string | null
  state: string | null
  power_units: number | null
  safety_rating: string | null
  carrier_status: string | null
  do_not_use: boolean | null
  gap_score: number | null
  requires_revetting: boolean | null
  flagged_scores: string[] | null
  approval_level: string | null
  score_upload_date: string | null
  auto_status: string | null
  cargo_status: string | null
  auto_expiration_date: string | null
  cargo_expiration_date: string | null
  rmis_overall_pass: boolean | null
  rmis_is_certified: boolean | null
  rmis_status: 'certified' | 'not_certified' | 'not_in_rmis' | 'pending' | null
  hard_stops: string[] | null
  insurance_fetched_at: string | null
  last_reviewed: string | null
  last_hauled_at: string | null
  revet_interval_days: number | null
  created_at: string | null
  brokerware_status: string | null
  business_type: string | null
  eld_enrolled: boolean | null
  w9_on_file: boolean | null
  agreement_on_file: boolean | null
  is_factoring: boolean | null
  noa_on_file: boolean
}

export interface CarrierRecord {
  id: string
  dot_number: string
  mc_number: string | null
  rmis_insured_id: string | null
  legal_name: string | null
  dba_name: string | null
  city: string | null
  state: string | null
  street: string | null
  zip: string | null
  power_units: number | null
  safety_rating: string | null
  carrier_status: string | null
  do_not_use: boolean | null
  do_not_use_reason: string | null
  revet_interval_days: number | null
  revet_reset_at: string | null
  last_hauled_at: string | null
  is_intrastate: boolean | null
  phone: string | null
  email: string | null
  brokerware_carrier_id: number | null
  brokerware_status: string | null
  brokerware_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface ScoreRecord {
  id: string
  dot_number: string
  gap_score: number | null
  crash_score: number | null
  violation_score: number | null
  csa_basics_score: number | null
  driver_oos_score: number | null
  critical_acute_violation_score: number | null
  new_entrant_score: number | null
  mcs_150_score: number | null
  judicial_hellholes_score: number | null
  safety_rating_score: number | null
  severity_category: string | null
  rating_label: string | null
  release_month: string | null
  overall_pass: boolean | null
  requires_revetting: boolean | null
  flagged_scores: string[] | null
  approval_level: string | null
  upload_date: string
}

export interface InsuranceRecord {
  id: string
  dot_number: string
  auto_status: string | null
  auto_limit: number | null
  auto_effective_date: string | null
  auto_expiration_date: string | null
  auto_underwriter: string | null
  auto_underwriter_rating: string | null
  auto_confidence: string | null
  auto_policy_number: string | null
  cargo_status: string | null
  cargo_limit: number | null
  cargo_effective_date: string | null
  cargo_expiration_date: string | null
  cargo_underwriter: string | null
  cargo_underwriter_rating: string | null
  cargo_confidence: string | null
  cargo_policy_number: string | null
  general_status: string | null
  general_occurrence_limit: number | null
  general_aggregate_limit: number | null
  general_expiration_date: string | null
  rmis_is_certified: boolean | null
  rmis_certification_notes: string[] | null
  broker_carrier_agreement_on_file: boolean | null
  broker_carrier_agreement_date: string | null
  broker_carrier_agreement_title: string | null
  w9_on_file: boolean | null
  w9_tax_id: string | null
  w9_business_name: string | null
  w9_company_type: string | null
  is_factoring: boolean | null
  pay_to_entity: string | null
  pay_to_address: string | null
  rmis_carrier_street: string | null
  rmis_carrier_city: string | null
  rmis_carrier_state: string | null
  rmis_carrier_zip: string | null
  rmis_email: string | null
  rmis_phone: string | null
  rmis_contact_name: string | null
  rmis_contact_title: string | null
  rmis_legal_name: string | null
  rmis_dba_name: string | null
  rmis_eld_enrolled: boolean | null
  operating_status: string | null
  common_authority_status: string | null
  contract_authority_status: string | null
  broker_authority_status: string | null
  authority_original_date: string | null
  authority_reinstatement_date: string | null
  authority_revocation_date: string | null
  authority_days_active: number | null
  us_total_inspections: number | null
  us_vehicle_oos_ratio: string | null
  us_driver_oos_ratio: string | null
  us_vehicle_oos_count: number | null
  us_driver_oos_count: number | null
  us_fatal_crashes: number | null
  us_injury_crashes: number | null
  us_tow_crashes: number | null
  us_total_crashes: number | null
  hard_stops: string[] | null
  rmis_flags: string[] | null
  rmis_overall_pass: boolean | null
  fetched_at: string | null
  updated_at: string | null
}

export interface VettingDocumentRecord {
  id: string
  vetting_record_id: string | null
  dot_number: string
  document_type: string | null
  file_name: string | null
  file_size_bytes: number | null
  mime_type: string | null
  google_drive_file_id: string | null
  google_drive_view_url: string | null
  storage_bucket: string | null
  storage_path: string | null
  source: string | null
  rmis_document_type: string | null
  content_sha256: string | null
  uploaded_by: string | null
  uploaded_at: string
  /** Resolved link (signed Storage URL or Drive view URL) from the documents API. */
  url?: string | null
}

export interface VettingRecord {
  id: string
  dot_number: string
  vetting_type: string
  vetting_status: string | null
  checklist: unknown
  exception_note: string | null
  internal_notes: string | null
  reviewed_by: string | null
  approved_by: string | null
  approval_level_required: string | null
  google_drive_folder_id: string | null
  google_drive_folder_url: string | null
  created_at: string
  completed_at: string | null
  documents?: VettingDocumentRecord[]
}

export interface DeltaLogRecord {
  id: string
  dot_number: string
  rmis_insured_id: string | null
  detected_at: string
  change_summary: string[] | null
  hard_stops_detected: string[] | null
  flags_detected: string[] | null
  previous_auto_status: string | null
  new_auto_status: string | null
  previous_cargo_status: string | null
  new_cargo_status: string | null
  previous_operating_status: string | null
  new_operating_status: string | null
  previous_safety_rating: string | null
  new_safety_rating: string | null
  alert_sent: boolean | null
  alert_sent_at: string | null
  processed: boolean | null
  reviewed_at: string | null
  reviewed_by: string | null
}

export interface SosRecord {
  id: string
  dot_number: string
  sos_state: string | null
  sos_entity_id: string | null
  sos_status: string | null
  sos_status_normalized: string | null
  sos_entity_type: string | null
  sos_formation_date: string | null
  sos_registered_agent: string | null
  sos_registered_agent_address: string | null
  sos_principal_address: string | null
  sos_officers: string[] | null
  name_match: boolean | null
  address_match: string | null
  match_confidence: string | null
  mismatches: string[] | null
  risk_flags: string[] | null
  sos_summary: string | null
  sos_source_url: string | null
  checked_at: string | null
  updated_at: string | null
}

export interface FactorRecord {
  id: string
  name: string
  normalized_name: string
  approval_status: string
  approved_by: string | null
  approved_at: string | null
  notes: string | null
  sos_state: string | null
  sos_entity_id: string | null
  sos_status: string | null
  sos_status_normalized: string | null
  sos_entity_type: string | null
  sos_formation_date: string | null
  sos_registered_agent: string | null
  sos_principal_address: string | null
  sos_match_confidence: string | null
  sos_summary: string | null
  sos_checked_at: string | null
  carrier_count?: number
}

export interface CarrierEventRecord {
  id: string
  event_type: string
  summary: string
  detail: Record<string, unknown> | null
  actor: string | null
  created_at: string
}

export interface CarrierDetail {
  carrier: CarrierRecord
  scores: ScoreRecord[]
  insurance: InsuranceRecord | null
  vettingRecords: VettingRecord[]
  deltaLog: DeltaLogRecord[]
  sos: SosRecord | null
  factor: FactorRecord | null
  events: CarrierEventRecord[]
  documentTypes?: string[]
}
