'use client'

import { useRef, useState } from 'react'
import { VettingDocumentRecord } from '@/lib/types'
import { Card, CardHeader, CardBody } from './ui/Card'
import { Button } from './ui/Button'
import { Input, Select } from './ui/Input'
import { Badge } from './ui/Badge'
import { Spinner } from './ui/Spinner'
import { formatDate } from '@/lib/utils'

const DOC_TYPES = [
  { value: 'broker_carrier_agreement', label: 'Broker-Carrier Agreement' },
  { value: 'w9', label: 'W-9' },
  { value: 'insurance_cert', label: 'Insurance Certificate' },
  { value: 'exception_note', label: 'Exception Note' },
  { value: 'osint_report', label: 'OSINT Report' },
  { value: 'fmcsa_screenshot', label: 'FMCSA Screenshot' },
  { value: 'other', label: 'Other' },
]

function typeLabel(v?: string | null): string {
  return DOC_TYPES.find((t) => t.value === v)?.label || v || 'Document'
}

export function DocumentUploader({
  vettingRecordId,
  documents,
  onUploaded,
}: {
  vettingRecordId: string | null
  documents: VettingDocumentRecord[]
  onUploaded?: () => void | Promise<void>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [docType, setDocType] = useState('broker_carrier_agreement')
  const [uploadedBy, setUploadedBy] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload() {
    if (!file || !vettingRecordId) return
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('documentType', docType)
      fd.append('uploadedBy', uploadedBy)
      const res = await fetch(`/api/vetting/${vettingRecordId}/document`, {
        method: 'POST',
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      await onUploaded?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Documents"
        subtitle="Uploaded to the carrier's Google Drive folder"
      />
      <CardBody>
        {!vettingRecordId ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Save a vetting record first to create the Drive folder, then upload
            documents here.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <Select
                label="Document type"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
              >
                {DOC_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-44">
              <Input
                label="Uploaded by"
                value={uploadedBy}
                onChange={(e) => setUploadedBy(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <div className="w-64">
              <label className="mb-1 block text-xs font-medium text-gray-600">
                File
              </label>
              <input
                ref={fileRef}
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-dts-blue file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-[#00547f]"
              />
            </div>
            <Button onClick={upload} disabled={!file || uploading}>
              {uploading ? <Spinner size={14} className="text-white" /> : null}
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-4">
          {documents.length === 0 ? (
            <p className="text-sm text-gray-500">No documents uploaded yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {documents.map((d) => (
                <a
                  key={d.id}
                  href={d.google_drive_view_url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 hover:bg-gray-50"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-900">
                      {d.file_name || 'Document'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatDate(d.uploaded_at)}
                      {d.uploaded_by ? ` · ${d.uploaded_by}` : ''}
                    </div>
                  </div>
                  <Badge tone="blue">{typeLabel(d.document_type)}</Badge>
                </a>
              ))}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
