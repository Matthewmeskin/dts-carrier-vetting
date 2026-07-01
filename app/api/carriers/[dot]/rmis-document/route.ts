import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchCarrierDocument, type RMISDocumentType } from '@/lib/rmisClient'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DOC_TYPES: RMISDocumentType[] = [
  'Certificate',
  'W9',
  'Agreement',
  'ClientAgreement',
  'Document',
]

// GET — fetch a document from RMIS for this carrier and stream it inline so the
// browser can open it (PDF/image) or download it.
export async function GET(
  request: NextRequest,
  { params }: { params: { dot: string } }
) {
  try {
    const dot = params.dot
    const type = request.nextUrl.searchParams.get('type') as RMISDocumentType | null
    const documentIDOverride = request.nextUrl.searchParams.get('documentID')

    if (!type || !DOC_TYPES.includes(type)) {
      return NextResponse.json(
        { error: `Invalid document type. Expected one of: ${DOC_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    const { data: carrier, error } = await supabaseAdmin
      .from('carriers')
      .select('rmis_insured_id, mc_number, dot_number')
      .eq('dot_number', dot)
      .single()
    if (error || !carrier) {
      return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })
    }

    const insdID = (carrier as any).rmis_insured_id
    if (!insdID) {
      return NextResponse.json(
        { error: 'Carrier has no RMIS insured ID on file — run an RMIS pull first.' },
        { status: 400 }
      )
    }

    // documentID is the RMIS-format MC number (e.g. "MC981214"). Brokerware
    // stores it without the prefix, so add it when missing.
    const rawMc = (carrier as any).mc_number
    const mcFormatted =
      rawMc && /^\d+$/.test(String(rawMc).trim())
        ? `MC${String(rawMc).trim()}`
        : rawMc
    const documentID = documentIDOverride || mcFormatted || dot

    const doc = await fetchCarrierDocument({
      insdID: String(insdID),
      documentType: type,
      documentID: String(documentID),
    })

    return new NextResponse(new Uint8Array(doc.buffer), {
      status: 200,
      headers: {
        'Content-Type': doc.contentType,
        'Content-Disposition': `inline; filename="${doc.fileName}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
