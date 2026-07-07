'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardHeader, CardBody } from './ui/Card'
import { Badge, type BadgeTone } from './ui/Badge'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'
import { formatDate, formatDateTime } from '@/lib/utils'

interface NoaVerification {
  is_noa: boolean
  assignee_name: string | null
  remittance_name: string | null
  remittance_address: string | null
  effective_date: string | null
  carrier_name_on_doc: string | null
  assignee_matches_factor: boolean
  payto_name_matches: boolean
  payto_address_match: 'match' | 'partial' | 'mismatch' | 'unknown'
  discrepancies: string[]
  summary: string
}

function matchBadge(ok: boolean): { tone: BadgeTone; label: string } {
  return ok ? { tone: 'green', label: 'Match' } : { tone: 'red', label: 'Mismatch' }
}

function addrTone(m: NoaVerification['payto_address_match']): BadgeTone {
  return m === 'match' ? 'green' : m === 'partial' ? 'amber' : m === 'mismatch' ? 'red' : 'gray'
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-gray-900">{value ?? '—'}</dd>
    </div>
  )
}

export function NoaPanel({ dot }: { dot: string }) {
  const [loading, setLoading] = useState(true)
  const [configured, setConfigured] = useState(true)
  const [onFile, setOnFile] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [uploadedAt, setUploadedAt] = useState<string | null>(null)
  const [verification, setVerification] = useState<NoaVerification | null>(null)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/carriers/${dot}/noa`, { cache: 'no-store' })
      const d = await res.json()
      setConfigured(Boolean(d.configured))
      setOnFile(Boolean(d.onFile))
      setFileName(d.fileName ?? null)
      setUploadedAt(d.uploadedAt ?? null)
      setVerification(d.verification ?? null)
      setCheckedAt(d.checkedAt ?? null)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [dot])

  useEffect(() => {
    load()
  }, [load])

  async function verify() {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch(`/api/carriers/${dot}/noa`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || `Verification failed (${res.status})`)
      setVerification(d.verification ?? null)
      setCheckedAt(new Date().toISOString())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed')
    } finally {
      setRunning(false)
    }
  }

  if (loading) return null

  const clean =
    verification &&
    verification.is_noa &&
    verification.assignee_matches_factor &&
    verification.payto_address_match === 'match' &&
    verification.discrepancies.length === 0

  return (
    <Card>
      <CardHeader
        title="Notice of Assignment (NOA)"
        subtitle="Factoring — verify assignee and pay-to address against RMIS"
        action={
          onFile && configured ? (
            <Button size="sm" variant="outline" onClick={verify} disabled={running}>
              {running ? <Spinner size={14} /> : null}
              {running ? 'Reading…' : verification ? 'Re-verify' : 'Verify NOA'}
            </Button>
          ) : undefined
        }
      />
      <CardBody>
        {/* On-file status */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {onFile ? (
            <Badge tone="green">NOA on file</Badge>
          ) : (
            <Badge tone="red">No NOA on file</Badge>
          )}
          {fileName && <span className="text-xs text-gray-500">{fileName}</span>}
          {uploadedAt && (
            <span className="text-xs text-gray-400">
              · archived {formatDate(uploadedAt)}
            </span>
          )}
        </div>

        {!onFile && (
          <p className="text-sm text-amber-700">
            This carrier is factoring but has no Notice of Assignment archived —
            required before payment. Pull it into RMIS (it archives automatically
            on the next refresh) or upload it to the carrier’s documents.
          </p>
        )}

        {onFile && !configured && (
          <p className="text-sm text-gray-500">
            The PDF reader isn’t configured. Set{' '}
            <code className="rounded bg-gray-100 px-1">ANTHROPIC_API_KEY</code> to
            enable automated NOA verification.
          </p>
        )}

        {error && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {onFile && configured && !verification && !running && !error && (
          <p className="text-sm text-gray-500">
            Click “Verify NOA” to read the document and confirm the assignee and
            pay-to address match this carrier’s factor.
          </p>
        )}

        {verification && (
          <>
            <div
              className={`mb-3 rounded-md border px-3 py-2 text-sm ${
                clean
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              {clean
                ? 'NOA verified — assignee and pay-to address match.'
                : 'NOA needs review — see discrepancies below.'}
              {verification.summary ? ` ${verification.summary}` : ''}
            </div>

            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field
                label="Is a valid NOA"
                value={
                  verification.is_noa ? (
                    <Badge tone="green">Yes</Badge>
                  ) : (
                    <Badge tone="red">No</Badge>
                  )
                }
              />
              <Field label="Assignee (factor)" value={verification.assignee_name} />
              <Field
                label="Assignee matches factor"
                value={
                  <Badge tone={matchBadge(verification.assignee_matches_factor).tone}>
                    {matchBadge(verification.assignee_matches_factor).label}
                  </Badge>
                }
              />
              <Field label="Remittance name" value={verification.remittance_name} />
              <Field
                label="Pay-to address match"
                value={
                  <Badge tone={addrTone(verification.payto_address_match)}>
                    {verification.payto_address_match}
                  </Badge>
                }
              />
              <Field
                label="Effective date"
                value={
                  verification.effective_date
                    ? formatDate(verification.effective_date)
                    : '—'
                }
              />
              <Field
                label="Remittance address"
                value={verification.remittance_address}
              />
              <Field
                label="Carrier on document"
                value={verification.carrier_name_on_doc}
              />
            </dl>

            {verification.discrepancies.length > 0 && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                  Discrepancies to resolve
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-amber-800">
                  {verification.discrepancies.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            )}

            {checkedAt && (
              <p className="mt-2 text-xs text-gray-400">
                Read by AI · {formatDateTime(checkedAt)} · verify against the source
                document before relying on it.
              </p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  )
}
