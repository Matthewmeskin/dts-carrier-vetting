import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUCKET = 'carrier-documents'
const SIGNED_URL_TTL = 60 * 60 // 1 hour

// GET — list all documents for a carrier, with a fresh signed URL for each
// file stored in Supabase Storage (Google Drive docs keep their view link).
export async function GET(
  _request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const dot = params.dot
    const { data: rows, error } = await supabaseAdmin
      .from('vetting_documents')
      .select('*')
      .eq('dot_number', dot)
      .order('uploaded_at', { ascending: false })
    if (error) throw error

    const documents = await Promise.all(
      (rows ?? []).map(async (d: any) => {
        let url: string | null = d.google_drive_view_url ?? null
        if (d.storage_path) {
          const { data: signed } = await supabaseAdmin.storage
            .from(d.storage_bucket || BUCKET)
            .createSignedUrl(d.storage_path, SIGNED_URL_TTL)
          url = signed?.signedUrl ?? null
        }
        return { ...d, url }
      })
    )

    return NextResponse.json({ documents })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}

// POST — record a document that the client already uploaded to Supabase Storage
// via a signed upload URL (see ./sign). We take metadata + the storage path in
// JSON — NOT the file bytes — so uploads of any size bypass Vercel's 4.5 MB
// serverless request-body limit (which previously rejected large PDFs with a
// non-JSON 413).
export async function POST(
  request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const dot = params.dot

    const { data: carrier, error: carrierError } = await supabaseAdmin
      .from('carriers')
      .select('id, dot_number')
      .eq('dot_number', dot)
      .single()
    if (carrierError || !carrier) {
      return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => null)
    const storagePath = body?.storagePath ? String(body.storagePath) : null
    if (!storagePath) {
      return NextResponse.json({ error: 'Missing storagePath' }, { status: 400 })
    }

    const docRow = {
      carrier_id: (carrier as any).id,
      dot_number: dot,
      document_type: body.documentType ? String(body.documentType) : null,
      file_name: body.fileName ? String(body.fileName) : null,
      file_size_bytes:
        typeof body.fileSizeBytes === 'number' ? body.fileSizeBytes : null,
      mime_type: body.mimeType ? String(body.mimeType) : null,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      uploaded_by: body.uploadedBy ? String(body.uploadedBy) : null,
      // Optionally tie the upload to a specific vetting review.
      vetting_record_id: body.vettingRecordId ? String(body.vettingRecordId) : null,
    }

    const { data: document, error: insertError } = await supabaseAdmin
      .from('vetting_documents')
      .insert([docRow])
      .select('*')
      .single()
    if (insertError) throw insertError

    const { data: signed } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL)

    return NextResponse.json({
      document: { ...document, url: signed?.signedUrl ?? null },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
