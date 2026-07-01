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

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

// POST — upload a document to Supabase Storage and record it against the carrier.
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

    const formData = await request.formData()
    const file = formData.get('file')
    const documentType = formData.get('documentType')
    const uploadedBy = formData.get('uploadedBy')
    const vettingRecordId = formData.get('vettingRecordId')

    if (!file || typeof (file as any).arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 })
    }

    const f = file as File
    const buffer = Buffer.from(await f.arrayBuffer())
    const path = `${dot}/${Date.now()}-${sanitizeName(f.name)}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: f.type || 'application/octet-stream',
        upsert: false,
      })
    if (uploadError) throw uploadError

    const docRow = {
      carrier_id: (carrier as any).id,
      dot_number: dot,
      document_type: documentType ? String(documentType) : null,
      file_name: f.name,
      file_size_bytes: buffer.length,
      mime_type: f.type || null,
      storage_bucket: BUCKET,
      storage_path: path,
      uploaded_by: uploadedBy ? String(uploadedBy) : null,
      // Optionally tie the upload to a specific vetting review.
      vetting_record_id: vettingRecordId ? String(vettingRecordId) : null,
    }

    const { data: document, error: insertError } = await supabaseAdmin
      .from('vetting_documents')
      .insert([docRow])
      .select('*')
      .single()
    if (insertError) throw insertError

    const { data: signed } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL)

    return NextResponse.json({
      document: { ...document, url: signed?.signedUrl ?? null },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
