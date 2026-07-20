import { createSupabaseBrowserClient } from './supabaseBrowser'

const BUCKET = 'carrier-documents'

export interface UploadDocInput {
  dot: string
  file: File
  documentType: string
  uploadedBy?: string
  vettingRecordId?: string | null
}

// Upload a carrier document DIRECTLY to Supabase Storage, bypassing Vercel's
// 4.5 MB serverless request-body limit (which rejected large PDFs with a
// non-JSON 413 that surfaced as "JSON.parse: unexpected character"). Three steps:
//  1) ask the server for a short-lived signed upload URL,
//  2) upload the bytes straight from the browser to Storage,
//  3) record the document row against the carrier.
export async function uploadCarrierDocument(input: UploadDocInput) {
  const { dot, file, documentType, uploadedBy, vettingRecordId } = input

  const signRes = await fetch(`/api/carriers/${dot}/documents/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name }),
  })
  const sign = await signRes.json().catch(() => ({}))
  if (!signRes.ok) throw new Error(sign.error || 'Could not start upload')

  const supabase = createSupabaseBrowserClient()
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .uploadToSignedUrl(sign.path, sign.token, file, {
      contentType: file.type || 'application/octet-stream',
    })
  if (upErr) throw new Error(upErr.message || 'Upload failed')

  const recRes = await fetch(`/api/carriers/${dot}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storagePath: sign.path,
      fileName: file.name,
      fileSizeBytes: file.size,
      mimeType: file.type || null,
      documentType,
      uploadedBy: uploadedBy || null,
      vettingRecordId: vettingRecordId || null,
    }),
  })
  const rec = await recRes.json().catch(() => ({}))
  if (!recRes.ok) throw new Error(rec.error || 'Could not save document')
  return rec.document
}
