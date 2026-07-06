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
    const [carrierRes, scoresRes, insRes, vetRes, deltaRes, sosRes] = await Promise.all([
      supabaseAdmin.from('carriers').select('*').eq('dot_number', dot).single(),
      supabaseAdmin
        .from('carrier_scores')
        .select('*')
        .eq('dot_number', dot)
        .order('upload_date', { ascending: false })
        .limit(6),
      (supabaseAdmin as any)
        .from('latest_carrier_insurance')
        // Select the display columns only — NOT raw_rmis_response (a large blob
        // that isn't used by the UI and was causing this query to come back empty).
        .select(
          'id, carrier_id, dot_number, auto_status, auto_limit, auto_effective_date, auto_expiration_date, auto_underwriter, auto_confidence, auto_policy_number, cargo_status, cargo_limit, cargo_effective_date, cargo_expiration_date, cargo_underwriter, cargo_confidence, cargo_policy_number, general_status, general_occurrence_limit, general_aggregate_limit, general_expiration_date, rmis_is_certified, rmis_certification_notes, broker_carrier_agreement_on_file, broker_carrier_agreement_date, broker_carrier_agreement_title, w9_on_file, w9_tax_id, w9_business_name, w9_company_type, is_factoring, pay_to_entity, pay_to_address, operating_status, contract_authority_status, authority_original_date, authority_reinstatement_date, authority_revocation_date, authority_days_active, us_total_inspections, us_vehicle_oos_ratio, us_driver_oos_ratio, us_vehicle_oos_count, us_driver_oos_count, us_fatal_crashes, us_injury_crashes, us_tow_crashes, us_total_crashes, hard_stops, rmis_flags, rmis_overall_pass, fetched_at, updated_at, common_authority_status, broker_authority_status'
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
      supabaseAdmin
        .from('carrier_sos')
        .select('*')
        .eq('dot_number', dot)
        .limit(1),
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
    // Strip the raw blob from the display object (keep the row otherwise).
    const sosRow =
      sosRes.data && sosRes.data.length > 0 ? sosRes.data[0] : null
    const sos = sosRow
      ? (({ sos_raw, ...rest }: any) => rest)(sosRow)
      : null

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

    return NextResponse.json({
      carrier,
      scores,
      insurance,
      vettingRecords: recordsWithDocs,
      deltaLog,
      sos,
      factor,
      _sosDebug: {
        error: (sosRes as any)?.error ?? null,
        count: Array.isArray((sosRes as any)?.data)
          ? (sosRes as any).data.length
          : null,
        status: (sosRes as any)?.status ?? null,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
