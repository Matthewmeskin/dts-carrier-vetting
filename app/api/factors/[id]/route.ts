import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — a single factor with its linked carriers and the SOS source link.
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { data: factor, error } = await supabaseAdmin
      .from('factors')
      .select('*')
      .eq('id', params.id)
      .single()
    if (error || !factor) {
      return NextResponse.json({ error: 'Factor not found' }, { status: 404 })
    }

    // Direct link to the state's official record, pulled from the raw OpenSOS
    // payload (source_url, or the state-specific sosUrl).
    const raw: any = (factor as any).sos_raw
    const sosSourceUrl: string | null =
      raw?.source_url ?? raw?.data?.sosUrl ?? null

    // Carriers pay this factor (variants roll up: every linked carrier points at
    // the canonical factor id).
    const { data: carriers } = await supabaseAdmin
      .from('carriers')
      .select('dot_number, legal_name, brokerware_status, carrier_status, city, state')
      .eq('factor_id', params.id)
      .order('legal_name', { ascending: true })
      .limit(100000)

    // Any spelling-variants merged into this factor (for transparency).
    const { data: variants } = await supabaseAdmin
      .from('factors')
      .select('name')
      .eq('merged_into', params.id)
      .order('name', { ascending: true })

    // Don't ship the big raw blob to the client.
    const { sos_raw, ...factorOut } = factor as any

    return NextResponse.json({
      factor: { ...factorOut, sos_source_url: sosSourceUrl },
      carriers: carriers ?? [],
      mergedVariants: (variants ?? []).map((v: any) => v.name),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
