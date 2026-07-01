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
    const [carrierRes, scoresRes, insRes, vetRes, deltaRes] = await Promise.all([
      supabaseAdmin.from('carriers').select('*').eq('dot_number', dot).single(),
      supabaseAdmin
        .from('carrier_scores')
        .select('*')
        .eq('dot_number', dot)
        .order('upload_date', { ascending: false })
        .limit(6),
      supabaseAdmin
        .from('carrier_insurance')
        .select('*')
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
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
