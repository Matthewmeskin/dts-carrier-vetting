'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardHeader, CardBody } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Badge } from './ui/Badge'
import { Spinner } from './ui/Spinner'
import { formatDateTime } from '@/lib/utils'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'
import { PaymentVettingReviewModal } from './PaymentVettingReviewModal'

const BUCKET = 'carrier-documents'

interface PvDoc {
  id: string
  document_type: string | null
  file_name: string | null
  uploaded_at: string | null
  uploaded_by: string | null
  source: string | null
  url: string | null
}

// Upload one file straight to Supabase Storage via a signed URL (bypasses the
// Vercel 4.5 MB body limit) and return its storage path.
async function uploadToStorage(dot: string, file: File): Promise<string> {
  const signRes = await fetch(`/api/carriers/${dot}/documents/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: `payment-${file.name}` }),
  })
  const sign = await signRes.json().catch(() => ({}))
  if (!signRes.ok) throw new Error(sign.error || 'Could not start upload')
  const supabase = createSupabaseBrowserClient()
  const { error } = await supabase.storage
    .from(BUCKET)
    .uploadToSignedUrl(sign.path, sign.token, file, {
      contentType: file.type || 'application/octet-stream',
    })
  if (error) throw new Error(error.message || 'Upload failed')
  return sign.path as string
}

export function PaymentVetting({ dot }: { dot: string }) {
  const [email, setEmail] = useState('')
  const [staffName, setStaffName] = useState('')
  const [loadNumber, setLoadNumber] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reports, setReports] = useState<PvDoc[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [reviewDoc, setReviewDoc] = useState<PvDoc | null>(null)

  // Default the destination email + staff name to the signed-in user.
  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const u = d?.user
        if (u?.email) setEmail((v) => v || u.email)
        if (u?.fullName) setStaffName((v) => v || u.fullName)
      })
      .catch(() => {})
  }, [])

  // Load this carrier's past payment-vetting reports + the original load docs.
  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/carriers/${dot}/documents`, {
        cache: 'no-store',
      })
      const data = await res.json()
      if (!res.ok) return
      const all: PvDoc[] = data.documents ?? []
      setReports(all.filter((d) => d.document_type === 'payment_vetting_log'))
    } catch {
      /* best-effort */
    }
  }, [dot])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  async function deleteReport(d: PvDoc) {
    if (!confirm(`Delete "${d.file_name || 'this report'}"? This cannot be undone.`)) {
      return
    }
    setDeletingId(d.id)
    setError(null)
    try {
      const res = await fetch(
        `/api/carriers/${dot}/documents?id=${encodeURIComponent(d.id)}`,
        { method: 'DELETE' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not delete report')
      setReports((rs) => rs.filter((r) => r.id !== d.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete report')
    } finally {
      setDeletingId(null)
    }
  }

  async function submit() {
    setError(null)
    setMessage(null)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError('Enter a valid email to send the report to.')
      return
    }
    if (files.length === 0) {
      setError('Attach at least one load document.')
      return
    }
    setSubmitting(true)
    try {
      const docs: {
        type: string
        storagePath: string
        fileName: string
        mimeType: string
      }[] = []
      for (const f of files) {
        const storagePath = await uploadToStorage(dot, f)
        docs.push({
          type: 'load_doc',
          storagePath,
          fileName: f.name,
          mimeType: f.type || 'application/octet-stream',
        })
      }

      const res = await fetch(`/api/carriers/${dot}/payment-vetting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          staffName: staffName || null,
          loadNumber: loadNumber || null,
          docs,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not start payment vetting')

      setMessage(
        `Submitted. The vetting report will be emailed to ${email} and appear below under this carrier's payment-vetting history within a few minutes.`
      )
      // Reset the file picker for the next load.
      setFiles([])
      setLoadNumber('')
      if (fileInput.current) fileInput.current.value = ''
      // Originals are saved immediately; the report lands when the workflow
      // posts back — refresh so the uploaded docs show right away.
      loadHistory()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start payment vetting')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Payment vetting (AP)"
        subtitle="Upload the load documents to verify this carrier's invoice before paying. The system analyzes the docs, cross-checks the remit-to against the carrier's pay-to on file, and returns a vetting log."
      />
      <CardBody>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            label="Email the report to"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ap@dtsone.com"
          />
          <Input
            label="Staff name"
            value={staffName}
            onChange={(e) => setStaffName(e.target.value)}
            placeholder="Your name"
          />
          <Input
            label="Load / Pro number (optional)"
            value={loadNumber}
            onChange={(e) => setLoadNumber(e.target.value)}
            placeholder="e.g. 12345"
          />
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Load documents
            <span className="ml-1 text-red-600">*</span>
            <span className="ml-2 font-normal text-gray-400">
              Invoice, BOL, rate con, POD, NOA — attach as many as you have
            </span>
          </label>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-dts-blue file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-[#00547f]"
          />
          {files.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-gray-600">
              {files.map((f, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span className="text-gray-400">•</span>
                  <span className="truncate">{f.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4">
          <Button onClick={submit} disabled={submitting || files.length === 0}>
            {submitting ? <Spinner size={14} className="text-white" /> : null}
            {submitting ? 'Submitting…' : 'Run payment vetting'}
          </Button>
          {message && <span className="text-sm text-green-700">{message}</span>}
          {error && <span className="text-sm text-red-700">{error}</span>}
        </div>

        {reports.length > 0 && (
          <div className="mt-5 border-t border-gray-200 pt-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Vetting reports ({reports.length})
            </h4>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {reports.map((d) => (
                <DocRow
                  key={d.id}
                  d={d}
                  tone="blue"
                  label="Report"
                  onDelete={() => deleteReport(d)}
                  deleting={deletingId === d.id}
                  onReview={() => setReviewDoc(d)}
                />
              ))}
            </div>
          </div>
        )}
      </CardBody>
      {reviewDoc && (
        <PaymentVettingReviewModal
          dot={dot}
          doc={reviewDoc}
          onClose={() => setReviewDoc(null)}
          onSaved={loadHistory}
        />
      )}
    </Card>
  )
}

function DocRow({
  d,
  tone,
  label,
  onDelete,
  deleting,
  onReview,
}: {
  d: PvDoc
  tone: 'blue' | 'gray'
  label: string
  onDelete?: () => void
  deleting?: boolean
  onReview?: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2 hover:bg-gray-50">
      <a
        href={d.url || '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-w-0 flex-1 items-center justify-between gap-3"
      >
        <div className="min-w-0">
          <span className="block truncate text-sm font-medium text-gray-900">
            {d.file_name || 'Document'}
          </span>
          <span className="text-xs text-gray-500">
            {formatDateTime(d.uploaded_at)}
            {d.uploaded_by ? ` · ${d.uploaded_by}` : ''}
          </span>
        </div>
        <Badge tone={tone}>{label}</Badge>
      </a>
      {onReview && (
        <button
          type="button"
          onClick={onReview}
          title="Open in portal & log review notes"
          className="shrink-0 rounded-md border border-dts-blue/30 px-2 py-1 text-xs font-medium text-dts-blue hover:bg-dts-blue/5"
        >
          Review
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          title="Delete report"
          aria-label="Delete report"
          className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        >
          {deleting ? <Spinner size={14} /> : '✕'}
        </button>
      )}
    </div>
  )
}
