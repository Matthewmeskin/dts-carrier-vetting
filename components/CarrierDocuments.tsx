'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { VettingDocumentRecord } from '@/lib/types'
import { Card, CardHeader, CardBody } from './ui/Card'
import { Button } from './ui/Button'
import { Input, Select } from './ui/Input'
import { Badge } from './ui/Badge'
import { Spinner } from './ui/Spinner'
import { formatDate } from '@/lib/utils'

const DOC_TYPES = [
  { value: 'broker_carrier_agreement', label: 'Broker-Carrier Agreement' },
  { value: 'tariff', label: 'Carrier Tariff / Alt. Agreement' },
  { value: 'w9', label: 'W-9' },
  { value: 'insurance_cert', label: 'Insurance Certificate' },
  { value: 'noa', label: 'Notice of Assignment (NOA)' },
  { value: 'exception_note', label: 'Exception Note' },
  { value: 'osint_report', label: 'OSINT Report' },
  { value: 'fmcsa_screenshot', label: 'FMCSA Screenshot' },
  { value: 'other', label: 'Other' },
]

function typeLabel(v?: string | null): string {
  return DOC_TYPES.find((t) => t.value === v)?.label || v || 'Document'
}

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function CarrierDocuments({
  dot,
  reloadKey,
  onChanged,
}: {
  dot: string
  reloadKey?: number
  /** Fired after an upload so the parent can refresh derived data (e.g. the
   *  vetting checklist's document-based auto-checks). */
  onChanged?: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [documents, setDocuments] = useState<VettingDocumentRecord[]>([])
  const [loading, setLoading] = useState(true)

  // Documents arrive newest-first; the first of each type is the current
  // version, the rest are superseded history.
  const currentIdByType = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of documents) {
      const key = d.document_type || 'other'
      if (!m.has(key)) m.set(key, d.id)
    }
    return m
  }, [documents])
  const [docType, setDocType] = useState('broker_carrier_agreement')
  const [uploadedBy, setUploadedBy] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/carriers/${dot}/documents`, {
        cache: 'no-store',
      })
      const data = await res.json()
      if (res.ok) setDocuments(data.documents ?? [])
    } finally {
      setLoading(false)
    }
  }, [dot])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  async function upload() {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('documentType', docType)
      fd.append('uploadedBy', uploadedBy)
      const res = await fetch(`/api/carriers/${dot}/documents`, {
        method: 'POST',
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      await load()
      onChanged?.()
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
        subtitle="Uploaded broker-carrier agreements, W-9s, insurance certs, OSINT, and more"
      />
      <CardBody>
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

        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Spinner size={16} /> Loading documents…
            </div>
          ) : documents.length === 0 ? (
            <p className="text-sm text-gray-500">No documents uploaded yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {documents.map((d) => (
                <a
                  key={d.id}
                  href={d.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 hover:bg-gray-50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-gray-900">
                        {d.file_name || 'Document'}
                      </span>
                      {d.source === 'rmis' && (
                        <Badge tone="green">RMIS</Badge>
                      )}
                      {currentIdByType.get(d.document_type || 'other') === d.id ? (
                        <Badge tone="blue">Current</Badge>
                      ) : (
                        <Badge tone="gray">Older</Badge>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatDate(d.uploaded_at)}
                      {d.uploaded_by ? ` · ${d.uploaded_by}` : ''}
                      {formatBytes(d.file_size_bytes)
                        ? ` · ${formatBytes(d.file_size_bytes)}`
                        : ''}
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
