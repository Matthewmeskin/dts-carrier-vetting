'use client'

import { useEffect, useRef, useState } from 'react'
import { Card, CardHeader, CardBody } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Spinner } from './ui/Spinner'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

const BUCKET = 'carrier-documents'

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
        `Submitted. The payment vetting log will be emailed to ${email} and attached to this carrier's Documents within a few minutes.`
      )
      // Reset the file picker for the next load.
      setFiles([])
      setLoadNumber('')
      if (fileInput.current) fileInput.current.value = ''
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
      </CardBody>
    </Card>
  )
}
