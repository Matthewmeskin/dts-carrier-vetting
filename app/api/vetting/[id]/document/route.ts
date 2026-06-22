import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { uploadFileToDrive } from '@/lib/googleDrive'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id

    const { data: record, error: recordError } = await supabaseAdmin
      .from('vetting_records')
      .select('id, google_drive_folder_id, carrier_id, dot_number')
      .eq('id', id)
      .single()

    if (recordError || !record || !(record as any).google_drive_folder_id) {
      return NextResponse.json(
        { error: 'Vetting record not found or has no Drive folder' },
        { status: 404 }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file')
    const documentType = formData.get('documentType')
    const uploadedBy = formData.get('uploadedBy')

    if (!file || typeof (file as any).arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 })
    }

    const f = file as File
    const buffer = Buffer.from(await f.arrayBuffer())

    const uploaded = await uploadFileToDrive(
      (record as any).google_drive_folder_id,
      f.name,
      buffer,
      f.type
    )

    const docRow = {
      vetting_record_id: (record as any).id,
      carrier_id: (record as any).carrier_id,
      dot_number: (record as any).dot_number,
      document_type: documentType ? String(documentType) : null,
      file_name: f.name,
      file_size_bytes: buffer.length,
      mime_type: f.type,
      google_drive_file_id: uploaded.id,
      google_drive_view_url: uploaded.webViewLink,
      uploaded_by: uploadedBy ? String(uploadedBy) : null,
    }

    const { data: document, error: insertError } = await supabaseAdmin
      .from('vetting_documents')
      .insert([docRow])
      .select('*')
      .single()
    if (insertError) throw insertError

    return NextResponse.json({ document })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
