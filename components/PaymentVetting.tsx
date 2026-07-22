'use client'

import { useEffect, useRef, useState } from 'react'
import { Card, CardHeader, CardBody } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Spinner } from './ui/Spinner'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

const BUCKET = 'carrier-documents'

// The documents a staffer prints/collects to clear a carrier invoice for
// payment (mirrors the paper "Vetting Log"). Invoice is required; the rest are
// attached when available.
const DOC_SLOTS: { key: string; label: string; required?: boolean }[] = [
  { key: 'invoice', label: 'Carrier Invoice', required: true },
  { key: 'bol', label: 'Bill of Lading (BOL)' },
  { key: 'dispatch', label: 'Dispatch Sheet / Rate Con' },
  { key: 'pod', label: 'Proof of Delivery (POD)' },
  { key: 'noa', label: 'Notice of Assignment (NOA)' },
]

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
  const [files, setFiles] = useState<Record<string, File | null>>({})
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})
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
    if (!files.invoice) {
      setError('The carrier invoice is required.')
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
      for (const slot of DOC_SLOTS) {
        const f = files[slot.key]
        if (!f) continue
        const storagePath = await uploadToStorage(dot, f)
        docs.push({
          type: slot.key,
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
      // Reset the file pickers for the next load.
      setFiles({})
      setLoadNumber('')
      Object.values(inputs.current).forEach((el) => {
        if (el) el.value = ''
      })
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
        subtitle="Upload the load documents to verify this carrier's invoice before paying. The system analyzes the docs, cross-checks the remit-to against the carrier's pay-to on file, runs OSINT, and returns a vetting log."
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

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {DOC_SLOTS.map((slot) => (
            <div key={slot.key}>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                {slot.label}
                {slot.required && <span className="ml-1 text-red-600">*</span>}
              </label>
              <input
                ref={(el) => {
                  inputs.current[slot.key] = el
                }}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
                onChange={(e) =>
                  setFiles((f) => ({ ...f, [slot.key]: e.target.files?.[0] ?? null }))
                }
                className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-dts-blue file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-[#00547f]"
              />
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4">
          <Button onClick={submit} disabled={submitting || !files.invoice}>
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
