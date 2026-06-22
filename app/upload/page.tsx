'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'

interface UploadResult {
  total: number
  flagged: number
  autoCleared: number
  errors: number
}

export default function UploadPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function upload() {
    if (!file) return
    setUploading(true)
    setError(null)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload-scores', {
        method: 'POST',
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setResult(data)
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">
          Upload Bluewire Scores
        </h1>
        <p className="text-sm text-gray-500">
          Upload the monthly Bluewire Excel export to refresh GAP and category
          scores for the entire network.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Monthly Excel upload"
          subtitle="Accepts the Bluewire .xlsx export with the standard column headers."
        />
        <CardBody>
          <div className="space-y-4">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-dts-blue file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#00547f]"
            />
            <Button onClick={upload} disabled={!file || uploading}>
              {uploading ? <Spinner size={14} className="text-white" /> : null}
              {uploading ? 'Processing…' : 'Upload & evaluate'}
            </Button>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            {result && (
              <div className="space-y-3 rounded-md border border-gray-200 p-4">
                <h3 className="text-sm font-semibold text-gray-900">
                  Upload complete
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Total rows" value={result.total} />
                  <Stat
                    label="Auto-cleared"
                    value={result.autoCleared}
                    tone="text-green-700"
                  />
                  <Stat
                    label="Flagged"
                    value={result.flagged}
                    tone="text-amber-600"
                  />
                  <Stat
                    label="Errors"
                    value={result.errors}
                    tone="text-red-600"
                  />
                </div>
                {result.flagged > 0 && (
                  <p className="text-sm text-gray-600">
                    {result.flagged} carrier(s) require revetting. An alert email
                    was sent to the compliance team.
                  </p>
                )}
                <Link
                  href="/carriers"
                  className="inline-block text-sm font-medium text-dts-blue hover:underline"
                >
                  View carriers →
                </Link>
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

function Stat({
  label,
  value,
  tone = 'text-gray-900',
}: {
  label: string
  value: number
  tone?: string
}) {
  return (
    <div className="rounded-md bg-gray-50 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
    </div>
  )
}
