import { createHash } from 'crypto'
import { supabaseAdmin } from './supabase'
import { fetchCarrierDocument, type RMISDocumentType } from './rmisClient'
import type { ParsedRMISData } from './rmisParser'

const BUCKET = 'carrier-documents'

export interface ArchiveResult {
  archived: number
  unchanged: number
  errors: string[]
}

interface Candidate {
  rmisType: RMISDocumentType
  docType: string
  onFile: boolean
}

function hasCoverage(status: string | null | undefined): boolean {
  return !!status && status !== 'No-Current-Info' && status !== 'Empty' && status !== ''
}

/**
 * Fetch each on-file RMIS document for a carrier and archive it to Supabase
 * Storage — but only when the content has changed since the last snapshot
 * (SHA-256 dedupe), so prior versions (old COIs, NOAs, agreements) are kept.
 */
export async function archiveCarrierDocuments(args: {
  dot: string
  carrierId: string | null
  insdID: string
  documentID: string
  parsed: ParsedRMISData
}): Promise<ArchiveResult> {
  const { dot, carrierId, insdID, parsed } = args
  const result: ArchiveResult = { archived: 0, unchanged: 0, errors: [] }

  // RMIS's Document API identifies the carrier's documents by DOT number.
  const documentID = dot

  const candidates: Candidate[] = [
    {
      rmisType: 'Certificate',
      docType: 'insurance_cert',
      onFile: hasCoverage(parsed.autoStatus) || hasCoverage(parsed.cargoStatus),
    },
    { rmisType: 'W9', docType: 'w9', onFile: parsed.w9OnFile },
    {
      rmisType: 'Agreement',
      docType: 'broker_carrier_agreement',
      onFile: parsed.brokerCarrierAgreementOnFile,
    },
  ]

  for (const c of candidates) {
    if (!c.onFile) continue
    try {
      const doc = await fetchCarrierDocument({
        insdID,
        documentType: c.rmisType,
        documentID,
      })
      const sha256 = createHash('sha256').update(doc.buffer).digest('hex')

      // Compare against the most recent stored version of this document type.
      const { data: latest } = await supabaseAdmin
        .from('vetting_documents')
        .select('content_sha256')
        .eq('dot_number', dot)
        .eq('rmis_document_type', c.rmisType)
        .order('uploaded_at', { ascending: false })
        .limit(1)

      if (latest && latest[0] && (latest[0] as any).content_sha256 === sha256) {
        result.unchanged++
        continue
      }

      const ext = doc.fileName.split('.').pop() || 'bin'
      const path = `${dot}/rmis/${c.rmisType}/${Date.now()}.${ext}`

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
            document_type: c.docType,
            rmis_document_type: c.rmisType,
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
      result.errors.push(`${c.rmisType}: ${e instanceof Error ? e.message : 'failed'}`)
    }
  }

  return result
}
