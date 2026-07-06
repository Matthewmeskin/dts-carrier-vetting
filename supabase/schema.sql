-- DTS Carrier Compliance Portal — Supabase schema
-- Run this in the Supabase SQL Editor before deploying the portal.

-- Core carrier identity record
create table carriers (
  id uuid primary key default gen_random_uuid(),
  dot_number text unique not null,
  mc_number text,
  rmis_insured_id text,
  legal_name text,
  dba_name text,
  city text,
  state text,
  street text,
  zip text,
  power_units integer,
  safety_rating text default 'Unrated',
  carrier_status text default 'Pending Review',
  -- carrier_status options: Approved, Approved with Restrictions,
  -- Exception Approved, Declined, Suspended, Do Not Use, Pending Review
  do_not_use boolean default false,
  do_not_use_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Monthly Bluewire GAP scores (one record per upload per carrier)
create table carrier_scores (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid references carriers(id) on delete cascade,
  dot_number text not null,
  gap_score numeric,
  crash_score numeric,
  violation_score numeric,
  csa_basics_score numeric,
  driver_oos_score numeric,
  critical_acute_violation_score numeric,
  new_entrant_score numeric,
  mcs_150_score numeric,
  judicial_hellholes_score numeric,
  safety_rating_score numeric,
  severity_category text,
  rating_label text,
  release_month text,
  -- Evaluation results
  overall_pass boolean,
  requires_revetting boolean,
  flagged_scores text[],
  approval_level text,
  -- approval_level options: auto_clear, additional_vetting,
  -- manager_exception, owner_exception
  upload_date timestamptz default now()
);

-- RMIS insurance and compliance data
create table carrier_insurance (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid references carriers(id) on delete cascade,
  dot_number text not null,
  -- Auto liability
  auto_status text,
  auto_limit numeric,
  auto_effective_date date,
  auto_expiration_date date,
  auto_underwriter text,
  auto_confidence text,
  auto_policy_number text,
  -- Cargo
  cargo_status text,
  cargo_limit numeric,
  cargo_effective_date date,
  cargo_expiration_date date,
  cargo_underwriter text,
  cargo_confidence text,
  cargo_policy_number text,
  -- General liability
  general_status text,
  general_occurrence_limit numeric,
  general_aggregate_limit numeric,
  general_expiration_date date,
  -- RMIS certification
  rmis_is_certified boolean,
  rmis_certification_notes text[],
  -- Broker carrier agreement
  broker_carrier_agreement_on_file boolean,
  broker_carrier_agreement_date timestamptz,
  broker_carrier_agreement_title text,
  -- W9
  w9_on_file boolean,
  w9_tax_id text,
  w9_business_name text,
  w9_company_type text,
  -- Factoring
  is_factoring boolean,
  pay_to_entity text,
  pay_to_address text,
  -- Authority
  operating_status text,
  contract_authority_status text,
  authority_original_date date,
  authority_reinstatement_date date,
  authority_revocation_date date,
  authority_days_active integer,
  -- Inspections
  us_total_inspections integer,
  us_vehicle_oos_ratio text,
  us_driver_oos_ratio text,
  us_vehicle_oos_count integer,
  us_driver_oos_count integer,
  -- Crashes
  us_fatal_crashes integer,
  us_injury_crashes integer,
  us_tow_crashes integer,
  us_total_crashes integer,
  -- Policy evaluation
  hard_stops text[],
  rmis_flags text[],
  rmis_overall_pass boolean,
  -- Raw response storage
  raw_rmis_response jsonb,
  fetched_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Human vetting records — one per vetting event
create table vetting_records (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid references carriers(id) on delete cascade,
  dot_number text not null,
  vetting_type text not null,
  -- vetting_type options: initial, monthly_review, revetting, exception
  vetting_status text,
  -- vetting_status options: approved, approved_with_restrictions,
  -- exception_approved, declined, in_progress
  checklist jsonb,
  exception_note text,
  internal_notes text,
  reviewed_by text,
  approved_by text,
  approval_level_required text,
  google_drive_folder_id text,
  google_drive_folder_url text,
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- Documents uploaded per carrier vetting
create table vetting_documents (
  id uuid primary key default gen_random_uuid(),
  vetting_record_id uuid references vetting_records(id) on delete cascade,
  carrier_id uuid references carriers(id) on delete cascade,
  dot_number text not null,
  document_type text,
  -- document_type options: broker_carrier_agreement, w9, insurance_cert,
  -- exception_note, osint_report, fmcsa_screenshot, other
  file_name text,
  file_size_bytes integer,
  mime_type text,
  google_drive_file_id text,
  google_drive_view_url text,
  uploaded_by text,
  uploaded_at timestamptz default now()
);

-- Delta change log — every time RMIS flags a carrier as changed
create table carrier_delta_log (
  id uuid primary key default gen_random_uuid(),
  dot_number text not null,
  rmis_insured_id text,
  detected_at timestamptz default now(),
  change_summary text[],
  hard_stops_detected text[],
  flags_detected text[],
  previous_auto_status text,
  new_auto_status text,
  previous_cargo_status text,
  new_cargo_status text,
  previous_operating_status text,
  new_operating_status text,
  previous_safety_rating text,
  new_safety_rating text,
  alert_sent boolean default false,
  alert_sent_at timestamptz,
  processed boolean default false
);

-- Alert history
create table alert_log (
  id uuid primary key default gen_random_uuid(),
  alert_type text,
  -- alert_type options: monthly_score_failure, delta_hard_stop,
  -- delta_flag, insurance_lapse
  dot_numbers text[],
  carrier_names text[],
  alert_summary text,
  sent_to text[],
  sent_at timestamptz default now()
);

-- Indexes
create index idx_carriers_dot on carriers(dot_number);
create index idx_carriers_rmis_id on carriers(rmis_insured_id);
create index idx_carriers_status on carriers(carrier_status);
create index idx_scores_dot on carrier_scores(dot_number);
create index idx_scores_upload_date on carrier_scores(upload_date desc);
create index idx_scores_requires_revetting on carrier_scores(requires_revetting)
  where requires_revetting = true;
create index idx_insurance_dot on carrier_insurance(dot_number);
create index idx_insurance_updated on carrier_insurance(updated_at desc);
create index idx_vetting_dot on vetting_records(dot_number);
create index idx_vetting_status on vetting_records(vetting_status);
create index idx_delta_dot on carrier_delta_log(dot_number);
create index idx_delta_detected on carrier_delta_log(detected_at desc);
create index idx_delta_hard_stops on carrier_delta_log(hard_stops_detected)
  where hard_stops_detected is not null;

-- Auto-update updated_at timestamps
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger carriers_updated_at
  before update on carriers
  for each row execute function update_updated_at();

create trigger carrier_insurance_updated_at
  before update on carrier_insurance
  for each row execute function update_updated_at();

-- ---------------------------------------------------------------------------
-- Secretary-of-State enrichment + approved-factors registry
-- ---------------------------------------------------------------------------

-- One row per unique factoring company (deduped by normalized_name) so SOS data
-- is pulled once per factor and reused across every carrier that shares it.
create table if not exists factors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text unique not null,
  approval_status text not null default 'review',   -- review | approved | rejected
  approved_by text,
  approved_at timestamptz,
  notes text,
  sos_state text,
  sos_entity_id text,
  sos_status text,
  sos_status_normalized text,       -- active | inactive | dissolved | delinquent | unknown
  sos_entity_type text,
  sos_formation_date date,
  sos_registered_agent text,
  sos_registered_agent_address text,
  sos_principal_address text,
  sos_officers jsonb default '[]'::jsonb,
  sos_match_confidence text,        -- high | medium | low | none
  sos_summary text,
  sos_raw jsonb,
  sos_checked_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Per-carrier Secretary-of-State snapshot (raw payload kept off the hot path).
create table if not exists carrier_sos (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid references carriers(id) on delete cascade,
  dot_number text unique not null,
  sos_state text,
  sos_entity_id text,
  sos_status text,
  sos_status_normalized text,
  sos_entity_type text,
  sos_formation_date date,
  sos_registered_agent text,
  sos_registered_agent_address text,
  sos_principal_address text,
  sos_officers jsonb default '[]'::jsonb,
  name_match boolean,
  address_match text,               -- match | partial | mismatch | unknown
  match_confidence text,            -- high | medium | low | none
  mismatches jsonb default '[]'::jsonb,
  risk_flags jsonb default '[]'::jsonb,
  sos_summary text,
  sos_raw jsonb,
  checked_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table carriers add column if not exists factor_id uuid references factors(id);

create index if not exists idx_carrier_sos_dot on carrier_sos (dot_number);
create index if not exists idx_carriers_factor_id on carriers (factor_id);
create index if not exists idx_factors_normalized on factors (normalized_name);

-- Preserve the raw Brokerware "Carrier/Factor" name; the sync parses the clean
-- carrier name into legal_name and the factor into the factors registry.
alter table carriers add column if not exists brokerware_raw_name text;

-- A factor spelling-variant can be merged into a canonical factor: the variant
-- row is kept (so re-sync doesn't recreate it) with a pointer to the canonical,
-- and carriers are linked to the canonical. The Factors list shows only
-- canonical rows; the sync follows merged_into when linking carriers.
alter table factors add column if not exists merged_into uuid references factors(id);
create index if not exists idx_factors_merged_into on factors (merged_into);

-- RMIS single-session mutex: the backfill and delta pollers (and any interactive
-- RMIS call) go through withRmisLock so they never hit the RMIS API concurrently
-- (RMIS allows one session per client; overlap => "Password could not be
-- validated"). TTL auto-frees a crashed holder's lock.
create table if not exists rmis_lock (
  id text primary key default 'rmis',
  holder text,
  locked_at timestamptz,
  expires_at timestamptz
);
insert into rmis_lock (id) values ('rmis') on conflict do nothing;

create or replace function acquire_rmis_lock(p_holder text, p_ttl_seconds int)
returns boolean language plpgsql as $$
declare ok boolean;
begin
  update rmis_lock set holder = p_holder, locked_at = now(),
         expires_at = now() + make_interval(secs => p_ttl_seconds)
   where id = 'rmis' and (holder is null or expires_at is null or expires_at < now())
  returning true into ok;
  return coalesce(ok, false);
end; $$;

create or replace function release_rmis_lock(p_holder text)
returns void language plpgsql as $$
begin
  update rmis_lock set holder = null, locked_at = null, expires_at = null
   where id = 'rmis' and holder = p_holder;
end; $$;

-- Carrier's real physical/mailing address from RMIS (FMCSA), distinct from
-- pay_to_address (the factor's remittance address). Used to search the carrier
-- in the correct Secretary of State; state derived from the ZIP when not explicit.
alter table carrier_insurance add column if not exists rmis_carrier_street text;
alter table carrier_insurance add column if not exists rmis_carrier_city text;
alter table carrier_insurance add column if not exists rmis_carrier_state text;
alter table carrier_insurance add column if not exists rmis_carrier_zip text;

-- Latest insurance row per carrier (server-side), so the API pulls ~one row per
-- carrier instead of the full history and never drops carriers past the row cap.
create or replace view latest_carrier_insurance as
select distinct on (dot_number) *
from carrier_insurance
order by dot_number, fetched_at desc nulls last, updated_at desc nulls last, id desc;

-- Insurer AM Best financial-strength rating (per coverage) from RMIS.
alter table carrier_insurance add column if not exists auto_underwriter_rating text;
alter table carrier_insurance add column if not exists cargo_underwriter_rating text;

-- Reliable carrier-SOS read (PostgREST column-select on carrier_sos was
-- intermittently returning zero rows for existing data).
create or replace function get_carrier_sos(p_dot text)
returns jsonb language sql stable as $$
  select to_jsonb(cs) - 'sos_raw' from carrier_sos cs
  where cs.dot_number = p_dot order by cs.checked_at desc nulls last limit 1;
$$;
grant execute on function get_carrier_sos(text) to anon, authenticated, service_role;
