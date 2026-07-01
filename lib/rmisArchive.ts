import { createHash } from 'crypto'
import { supabaseAdmin } from './supabase'
import { fetchCarrierDocument, type RMISDocumentType } from './rmisClient'

const BUCKET = 'carrier-documents'

export interface ArchiveResult {
  archived: number
  unchanged: number
  errors: string[]
}

interface Target {
  rmisType: RMISDocumentType
  docType: string
  documentID: string
  label: string
}

// Map a Documents-section description to our internal document_type.
function mapDescription(desc: string): string {
  const d = desc.toLowerCase()
  if (d.includes('notice of assignment') || d.includes('noa')) return 'noa'
  if (d.includes('w9') || d.includes('w-9')) return 'w9'
  if (d.includes('certificate') || d.includes('coi')) return 'insurance_cert'
  if (d.includes('agreement')) return 'broker_carrier_agreement'
  return 'other'
}

function tagValue(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)
  return m ? m[1].trim() : null
}

/**
 * Discover a carrier's documents from the Expanded Carrier XML and archive each
 * to Supabase Storage — the insurance certificate (RMISImageID) plus every
 * uploaded document in the <Documents> list (DocumentID). Content is deduped by
 * SHA-256 so prior versions are kept without duplicates.
 */
export async function archiveCarrierDocuments(args: {
  dot: string
  carrierId: string | null
  insdID: string
  xml: string
}): Promise<ArchiveResult> {
  const { dot, carrierId, insdID, xml } = args
  const result: ArchiveResult = { archived: 0, unchanged: 0, errors: [] }

  const targets: Target[] = []

  // Insurance certificate — retrieved by its RMIS image id.
  const certImageID = tagValue(xml, 'RMISImageID')
  if (certImageID) {
    targets.push({
      rmisType: 'Certificate',
      docType: 'insurance_cert',
      documentID: certImageID,
      label: 'Insurance Certificate',
    })
  }

  // Uploaded documents (NOA, agreements, etc.) listed in <Documents>.
  const docsSection = tagValue(xml, 'Documents') ?? ''
  const docMatches = docsSection.match(/<Document>[\s\S]*?<\/Document>/gi) ?? []
  for (const block of docMatches) {
    const id = tagValue(block, 'DocumentID')
    if (!id) continue
    const description = tagValue(block, 'Description') ?? 'Document'
    targets.push({
      rmisType: 'Document',
      docType: mapDescription(description),
      documentID: id,
      label: description,
    })
  }

  for (const t of targets) {
    try {
      const doc = await fetchCarrierDocument({
        insdID,
        documentType: t.rmisType,
        documentID: t.documentID,
      })
      const sha256 = createHash('sha256').update(doc.buffer).digest('hex')

      // Dedupe by content across this carrier's documents.
      const { data: existing } = await supabaseAdmin
        .from('vetting_documents')
        .select('id')
        .eq('dot_number', dot)
        .eq('content_sha256', sha256)
        .limit(1)
      if (existing && existing.length > 0) {
        result.unchanged++
        continue
      }

      const ext = doc.fileName.split('.').pop() || 'bin'
      const path = `${dot}/rmis/${t.rmisType}/${t.documentID}-${Date.now()}.${ext}`

      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, doc.buffer, { contentType: doc.contentType, upsert: false })
      if (uploadError) throw uploadError

      const { error: insertError } = await supabaseAdmin
        .from('vetting_documents')
        .insert([
          {
            carrier_id: carrierId,
            dot_number: dot,
            document_type: t.docType,
            rmis_document_type: t.rmisType,
            source: 'rmis',
            content_sha256: sha256,
            file_name: doc.fileName,
            file_size_bytes: doc.buffer.length,
            mime_type: doc.contentType,
            storage_bucket: BUCKET,
            storage_path: path,
            uploaded_by: 'RMIS (auto)',
          },
        ])
      if (insertError) throw insertError

      result.archived++
    } catch (e) {
      result.errors.push(`${t.label}: ${e instanceof Error ? e.message : 'failed'}`)
    }
  }

  return result
}
