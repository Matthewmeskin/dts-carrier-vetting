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

    const { data: carrier, error: carrierError } = await supabaseAdmin
      .from('carriers')
      .select('*')
      .eq('dot_number', dot)
      .single()

    if (carrierError || !carrier) {
      return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })
    }

    const { data: scores } = await supabaseAdmin
      .from('carrier_scores')
      .select('*')
      .eq('dot_number', dot)
      .order('upload_date', { ascending: false })
      .limit(6)

    const { data: insuranceRows } = await supabaseAdmin
      .from('carrier_insurance')
      .select('*')
      .eq('dot_number', dot)
      .order('updated_at', { ascending: false })
      .limit(1)

    const insurance = insuranceRows && insuranceRows.length > 0 ? insuranceRows[0] : null

    const { data: vettingRecords } = await supabaseAdmin
      .from('vetting_records')
      .select('*')
      .eq('dot_number', dot)
      .order('created_at', { ascending: false })
      .limit(5)

    const recordsWithDocs = []
    for (const record of vettingRecords ?? []) {
      const { data: documents } = await supabaseAdmin
        .from('vetting_documents')
        .select('*')
        .eq('vetting_record_id', (record as any).id)
        .order('uploaded_at', { ascending: false })
      recordsWithDocs.push({ ...(record as any), documents: documents ?? [] })
    }

    const { data: deltaLog } = await supabaseAdmin
      .from('carrier_delta_log')
      .select('*')
      .eq('dot_number', dot)
      .order('detected_at', { ascending: false })
      .limit(30)

    return NextResponse.json({
      carrier,
      scores: scores ?? [],
      insurance,
      vettingRecords: recordsWithDocs,
      deltaLog: deltaLog ?? [],
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
