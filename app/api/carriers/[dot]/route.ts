import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const dot = params.dot

    // Fetch everything the detail page needs in parallel — these are all keyed
    // by dot_number and independent of each other.
    const [carrierRes, scoresRes, insRes, vetRes, deltaRes, sosRes, eventsRes] = await Promise.all([
      supabaseAdmin.from('carriers').select('*').eq('dot_number', dot).single(),
      supabaseAdmin
        .from('carrier_scores')
        .select('*')
        .eq('dot_number', dot)
        .order('upload_date', { ascending: false })
        .limit(12),
      (supabaseAdmin as any)
        .from('latest_carrier_insurance')
        // Select the display columns only — NOT raw_rmis_response (a large blob
        // that isn't used by the UI and was causing this query to come back empty).
        .select(
          'id, carrier_id, dot_number, auto_status, auto_limit, auto_effective_date, auto_expiration_date, auto_underwriter, auto_underwriter_rating, auto_confidence, auto_policy_number, cargo_status, cargo_limit, cargo_effective_date, cargo_expiration_date, cargo_underwriter, cargo_underwriter_rating, cargo_confidence, cargo_policy_number, general_status, general_occurrence_limit, general_aggregate_limit, general_expiration_date, rmis_is_certified, rmis_certification_notes, broker_carrier_agreement_on_file, broker_carrier_agreement_date, broker_carrier_agreement_title, w9_on_file, w9_tax_id, w9_business_name, w9_company_type, is_factoring, pay_to_entity, pay_to_address, operating_status, contract_authority_status, authority_original_date, authority_reinstatement_date, authority_revocation_date, authority_days_active, us_total_inspections, us_vehicle_oos_ratio, us_driver_oos_ratio, us_vehicle_oos_count, us_driver_oos_count, us_fatal_crashes, us_injury_crashes, us_tow_crashes, us_total_crashes, hard_stops, rmis_flags, rmis_overall_pass, fetched_at, updated_at, common_authority_status, broker_authority_status, rmis_carrier_street, rmis_carrier_city, rmis_carrier_state, rmis_carrier_zip, rmis_legal_name, rmis_dba_name, rmis_eld_enrolled'
        )
        .eq('dot_number', dot)
        .order('updated_at', { ascending: false })
        .limit(1),
      supabaseAdmin
        .from('vetting_records')
        .select('*')
        .eq('dot_number', dot)
        .order('created_at', { ascending: false })
        .limit(5),
      supabaseAdmin
        .from('carrier_delta_log')
        .select('*')
        .eq('dot_number', dot)
        .order('detected_at', { ascending: false })
        .limit(30),
      // Read via a DB function (returns the row as jsonb, minus the raw blob) —
      // PostgREST's column-select on carrier_sos intermittently returned zero
      // rows for existing data, so we bypass it.
      (supabaseAdmin as any).rpc('get_carrier_sos', { p_dot: dot }),
      (supabaseAdmin as any)
        .from('carrier_events')
        .select('id, event_type, summary, detail, actor, created_at')
        .eq('dot_number', dot)
        .order('created_at', { ascending: false })
        .limit(50),
    ])

    const carrier = carrierRes.data
    if (carrierRes.error || !carrier) {
      return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })
    }

    const scores = scoresRes.data ?? []
    const insurance =
      insRes.data && insRes.data.length > 0 ? insRes.data[0] : null
    const vettingRecords = vetRes.data ?? []
    const deltaLog = deltaRes.data ?? []
    // The function returns the row as a jsonb object (or null when absent).
    const sos = (sosRes as any).data ?? null

    // The linked (deduped) factor, with its SOS + approval status.
    let factor: any = null
    if ((carrier as any).factor_id) {
      const { data: f } = await supabaseAdmin
        .from('factors')
        .select(
          'id, name, normalized_name, approval_status, approved_by, approved_at, notes, sos_state, sos_entity_id, sos_status, sos_status_normalized, sos_entity_type, sos_formation_date, sos_registered_agent, sos_principal_address, sos_match_confidence, sos_summary, sos_checked_at'
        )
        .eq('id', (carrier as any).factor_id)
        .single()
      factor = f ?? null
    }

    // One query for all documents across these vetting records (no N+1 loop).
    const recordIds = vettingRecords.map((r: any) => r.id)
    const docsByRecord: Record<string, any[]> = {}
    if (recordIds.length > 0) {
      const { data: docs } = await supabaseAdmin
        .from('vetting_documents')
        .select('*')
        .in('vetting_record_id', recordIds)
        .order('uploaded_at', { ascending: false })
      for (const d of docs ?? []) {
        const key = (d as any).vetting_record_id
        ;(docsByRecord[key] ??= []).push(d)
      }
    }
    const recordsWithDocs = vettingRecords.map((r: any) => ({
      ...r,
      documents: docsByRecord[r.id] ?? [],
    }))

    // Distinct document types on file for this carrier (any source — RMIS
    // archive or a manual portal upload, tied to a review or not). Lets the
    // vetting checklist treat a portal-uploaded BCA/W-9 as satisfying its step.
    const { data: allDocs } = await supabaseAdmin
      .from('vetting_documents')
      .select('document_type')
      .eq('dot_number', dot)
    const documentTypes = Array.from(
      new Set((allDocs ?? []).map((d: any) => d.document_type).filter(Boolean))
    )

    return NextResponse.json({
      carrier,
      scores,
      insurance,
      vettingRecords: recordsWithDocs,
      deltaLog,
      sos,
      factor,
      documentTypes,
      events: (eventsRes as any).data ?? [],
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
