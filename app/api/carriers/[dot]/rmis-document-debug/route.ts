import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BASE = process.env.RMIS_BASE_URL || 'https://api.rmissecure.com'

// Diagnostic: returns the RAW RMIS Document API response (no decoding) so we can
// see exactly what RMIS sends back. Does not expose credentials.
export async function GET(
  request: NextRequest,
  { params }: { params: { dot: string } }
) {
  try {
    const dot = params.dot
    const type = request.nextUrl.searchParams.get('type') || 'Certificate'

    const { data: carrier } = await supabaseAdmin
      .from('carriers')
      .select('rmis_insured_id, mc_number')
      .eq('dot_number', dot)
      .single()
    if (!carrier) {
      return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })
    }

    const clientID = process.env.RMIS_CLIENT_ID
    const pwd = process.env.RMIS_CLIENT_PASSWORD
    if (!clientID || !pwd) {
      return NextResponse.json({ error: 'RMIS credentials not configured' }, { status: 500 })
    }

    const insdID = String((carrier as any).rmis_insured_id ?? '')
    const rawMc = (carrier as any).mc_number
    const mc =
      rawMc && /^\d+$/.test(String(rawMc).trim())
        ? `MC${String(rawMc).trim()}`
        : rawMc
    const documentID = String(mc || dot)

    const q = new URLSearchParams({
      clientID,
      pwd,
      documentType: type,
      documentID,
      insdID,
      version: '1',
    })
    const res = await fetch(`${BASE}/_c/std/api/DocumentAPI.aspx?${q.toString()}`, {
      cache: 'no-store',
    })
    const text = await res.text()

    return NextResponse.json({
      sentParams: { documentType: type, documentID, insdID, version: '1' },
      httpStatus: res.status,
      responseLength: text.length,
      responsePreview: text.slice(0, 2500),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
