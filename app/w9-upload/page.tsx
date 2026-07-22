'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { uploadCarrierDocument } from '@/lib/uploadDocument'

type MatchStatus =
  | 'matched'
  | 'already_has_w9'
  | 'ambiguous'
  | 'unmatched'

interface MatchResult {
  fileName: string
  status: MatchStatus
  carrierId?: string
  dot?: string
  legalName?: string | null
  dbaName?: string | null
  candidates?: { carrierId: string; dot: string; legalName: string | null }[]
}

type UploadState = 'idle' | 'uploading' | 'done' | 'error'

const STATUS_META: Record<MatchStatus, { tone: BadgeTone; label: string }> = {
  matched: { tone: 'green', label: 'Matched' },
  already_has_w9: { tone: 'amber', label: 'Already has W-9' },
  ambiguous: { tone: 'amber', label: 'Ambiguous — skipped' },
  unmatched: { tone: 'red', label: 'No carrier match' },
}

export default function W9UploadPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [matches, setMatches] = useState<MatchResult[]>([])
  const [matching, setMatching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [includeExisting, setIncludeExisting] = useState(false)
  const [uploadedBy, setUploadedBy] = useState('')
  const [uploading, setUploading] = useState(false)
  const [state, setState] = useState<Record<string, { s: UploadState; msg?: string }>>({})

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const name = d?.user?.fullName
        if (name) setUploadedBy((v) => v || name)
      })
      .catch(() => {})
  }, [])

  const fileByName = useMemo(() => {
    const m = new Map<string, File>()
    for (const f of files) m.set(f.name, f)
    return m
  }, [files])

  async function onPick(picked: File[]) {
    setFiles(picked)
    setMatches([])
    setState({})
    setError(null)
    if (picked.length === 0) return
    setMatching(true)
    try {
      const res = await fetch('/api/admin/w9-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileNames: picked.map((f) => f.name) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Matching failed')
      setMatches(data.results ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Matching failed')
    } finally {
      setMatching(false)
    }
  }

  const uploadable = matches.filter(
    (m) =>
      m.carrierId &&
      m.dot &&
      (m.status === 'matched' || (includeExisting && m.status === 'already_has_w9'))
  )

  async function uploadAll() {
    setUploading(true)
    for (const m of uploadable) {
      const file = fileByName.get(m.fileName)
      if (!file || !m.dot) continue
      setState((s) => ({ ...s, [m.fileName]: { s: 'uploading' } }))
      try {
        await uploadCarrierDocument({
          dot: m.dot,
          file,
          documentType: 'w9',
          uploadedBy: uploadedBy || 'W-9 batch upload',
        })
        setState((s) => ({ ...s, [m.fileName]: { s: 'done' } }))
      } catch (e) {
        setState((s) => ({
          ...s,
          [m.fileName]: {
            s: 'error',
            msg: e instanceof Error ? e.message : 'Upload failed',
          },
        }))
      }
    }
    setUploading(false)
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const m of matches) c[m.status] = (c[m.status] ?? 0) + 1
    return c
  }, [matches])

  const doneCount = Object.values(state).filter((v) => v.s === 'done').length

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link href="/carriers" className="text-sm text-dts-blue hover:underline">
          ← Back to carriers
        </Link>
        <h1 className="mt-2 text-xl font-bold text-gray-900">Bulk W-9 upload</h1>
        <p className="text-sm text-gray-500">
          Drop a batch of W-9 PDFs. Each file is matched to a carrier by its
          filename (legal or DBA name). Confident matches upload as the carrier’s
          W-9; ambiguous or unmatched files are listed for you to handle manually.
        </p>
      </div>

      <Card>
        <CardHeader title="1. Choose files" />
        <CardBody>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf"
              onChange={(e) => onPick(Array.from(e.target.files ?? []))}
              className="block text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-dts-blue file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-[#00547f]"
            />
            {matching && (
              <span className="inline-flex items-center gap-2 text-sm text-gray-500">
                <Spinner size={16} /> Matching {files.length} files…
              </span>
            )}
          </div>
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        </CardBody>
      </Card>

      {matches.length > 0 && (
        <Card>
          <CardHeader
            title="2. Review matches"
            subtitle={`${counts.matched ?? 0} matched · ${
              counts.already_has_w9 ?? 0
            } already have a W-9 · ${counts.ambiguous ?? 0} ambiguous · ${
              counts.unmatched ?? 0
            } unmatched`}
          />
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-1 pr-3">File</th>
                    <th className="py-1 pr-3">Matched carrier</th>
                    <th className="py-1 pr-3">Status</th>
                    <th className="py-1">Upload</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => {
                    const meta = STATUS_META[m.status]
                    const st = state[m.fileName]
                    return (
                      <tr key={m.fileName} className="border-t border-gray-100">
                        <td className="py-1.5 pr-3 align-top">
                          <span className="break-all">{m.fileName}</span>
                        </td>
                        <td className="py-1.5 pr-3 align-top">
                          {m.legalName ? (
                            <Link
                              href={`/carriers/${m.dot}`}
                              className="text-dts-blue hover:underline"
                            >
                              {m.legalName}
                            </Link>
                          ) : m.status === 'ambiguous' ? (
                            <span className="text-gray-500">
                              {m.candidates?.map((c) => c.legalName).join(' / ')}
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                          {m.dot && (
                            <span className="ml-1 text-xs text-gray-400">
                              DOT {m.dot}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 align-top">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </td>
                        <td className="py-1.5 align-top">
                          {st?.s === 'uploading' ? (
                            <Spinner size={14} />
                          ) : st?.s === 'done' ? (
                            <span className="text-green-700">✓ Uploaded</span>
                          ) : st?.s === 'error' ? (
                            <span className="text-red-700" title={st.msg}>
                              ✕ {st.msg?.slice(0, 40)}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {matches.length > 0 && (
        <Card>
          <CardHeader title="3. Upload" />
          <CardBody>
            <label className="mb-3 flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={includeExisting}
                onChange={(e) => setIncludeExisting(e.target.checked)}
              />
              Also upload for carriers that already have a W-9 on file (adds a new
              version)
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={uploadAll} disabled={uploading || uploadable.length === 0}>
                {uploading ? <Spinner size={14} className="text-white" /> : null}
                {uploading
                  ? `Uploading… (${doneCount}/${uploadable.length})`
                  : `Upload ${uploadable.length} W-9${uploadable.length === 1 ? '' : 's'}`}
              </Button>
              {doneCount > 0 && !uploading && (
                <span className="text-sm text-green-700">
                  Uploaded {doneCount} W-9(s).
                </span>
              )}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
