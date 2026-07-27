'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SosRecord, FactorRecord } from '@/lib/types'
import { Badge, type BadgeTone } from './ui/Badge'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'
import { formatDate, formatDateTime } from '@/lib/utils'

function statusTone(norm: string | null | undefined): BadgeTone {
  switch ((norm || '').toLowerCase()) {
    case 'active':
      return 'green'
    case 'delinquent':
      return 'amber'
    case 'dissolved':
    case 'inactive':
      return 'red'
    default:
      return 'gray'
  }
}

function factorTone(status: string | null | undefined): BadgeTone {
  switch (status) {
    case 'approved':
      return 'green'
    case 'rejected':
      return 'red'
    default:
      return 'amber'
  }
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-gray-900">{value ?? '—'}</dd>
    </div>
  )
}

export function SosPanel({
  dot,
  sos,
  factor,
  onRefreshed,
}: {
  dot: string
  sos: SosRecord | null
  factor: FactorRecord | null
  onRefreshed?: () => void | Promise<void>
}) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [running, setRunning] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removed, setRemoved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset the optimistic "removed" flag whenever a different SOS record arrives
  // (e.g. after re-running the check). Once cleared, the parent reload returns a
  // null record so the block stays hidden.
  useEffect(() => {
    setRemoved(false)
  }, [sos?.id])

  useEffect(() => {
    let alive = true
    fetch(`/api/carriers/${dot}/sos`)
      .then((r) => r.json())
      .then((d) => alive && setConfigured(Boolean(d.configured)))
      .catch(() => alive && setConfigured(false))
    return () => {
      alive = false
    }
  }, [dot])

  async function run(fresh: boolean) {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch(`/api/carriers/${dot}/sos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fresh }),
      })
      // The response can be a non-JSON platform error page (e.g. a timeout), so
      // parse defensively instead of letting res.json() throw a cryptic error.
      const text = await res.text()
      let data: any = {}
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        if (res.status === 504 || res.status === 408) {
          throw new Error(
            'The SOS lookup timed out. Try again — results are cached after the first pull, so a retry is usually fast.'
          )
        }
        throw new Error(`Unexpected response from the server (status ${res.status}).`)
      }
      if (!res.ok) throw new Error(data.error || `SOS lookup failed (${res.status})`)
      if (data.errors?.length) setError(data.errors.join(' · '))
      await onRefreshed?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'SOS lookup failed')
    } finally {
      setRunning(false)
    }
  }

  async function remove() {
    if (
      !window.confirm(
        'Remove the stored Secretary-of-State record for this carrier? This clears the current match — you can re-run the check afterward.'
      )
    )
      return
    setRemoving(true)
    setError(null)
    try {
      const res = await fetch(`/api/carriers/${dot}/sos`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Remove failed (${res.status})`)
      // Hide the block immediately; the parent reload then returns a null record.
      setRemoved(true)
      await onRefreshed?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Remove failed')
    } finally {
      setRemoving(false)
    }
  }

  // `removed` optimistically hides the block the moment Remove succeeds, before
  // the parent reload returns the now-null record.
  const activeSos = removed ? null : sos

  return (
    <div className="mt-5 border-t border-gray-100 pt-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-bold text-gray-900">Business Registration (SOS)</h3>
          <span className="text-xs text-gray-400">Secretary of State · via OpenSOS</span>
        </div>
        {configured && (
          <div className="flex items-center gap-2">
            {activeSos?.sos_source_url && (
              <a
                href={activeSos.sos_source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-dts-blue hover:underline"
              >
                View on Secretary of State ↗
              </a>
            )}
            {running && <Spinner size={16} />}
            <Button size="sm" variant="outline" onClick={() => run(false)} disabled={running}>
              {activeSos ? 'Re-check' : 'Run SOS check'}
            </Button>
            {activeSos && (
              <Button size="sm" variant="ghost" onClick={() => run(true)} disabled={running}>
                Force fresh
              </Button>
            )}
            {activeSos && (
              <Button
                size="sm"
                variant="ghost"
                onClick={remove}
                disabled={running || removing}
                className="text-red-600 hover:bg-red-50"
              >
                {removing ? 'Removing…' : 'Remove'}
              </Button>
            )}
          </div>
        )}
      </div>

      {configured === false && (
        <p className="text-sm text-gray-500">
          Secretary-of-State lookups are not configured yet. Set{' '}
          <code className="rounded bg-gray-100 px-1">OPENSOS_API_KEY</code> and{' '}
          <code className="rounded bg-gray-100 px-1">ANTHROPIC_API_KEY</code> to enable.
        </p>
      )}

      {error && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {error}
        </div>
      )}

      {configured && !activeSos && !running && !error && (
        <p className="text-sm text-gray-500">
          No SOS record pulled yet. Click “Run SOS check” to verify this carrier’s legal-entity
          registration.
        </p>
      )}

      {sos && !removed && (
        <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field
              label="Entity Status"
              value={
                <Badge tone={statusTone(sos.sos_status_normalized)}>
                  {sos.sos_status || sos.sos_status_normalized || 'Unknown'}
                </Badge>
              }
            />
            <Field label="State" value={sos.sos_state} />
            <Field label="Entity Type" value={sos.sos_entity_type} />
            <Field label="Formation Date" value={formatDate(sos.sos_formation_date)} />
            <Field label="State Entity ID" value={sos.sos_entity_id} />
            <Field
              label="Name Match"
              value={
                sos.name_match === true ? (
                  <Badge tone="green">Match</Badge>
                ) : sos.name_match === false ? (
                  <Badge tone="red">Mismatch</Badge>
                ) : (
                  '—'
                )
              }
            />
            <Field label="Registered Agent" value={sos.sos_registered_agent} />
            <Field
              label="Principal Address"
              value={sos.sos_principal_address}
            />
            <Field
              label="Address Match"
              value={
                sos.address_match ? (
                  <Badge
                    tone={
                      sos.address_match === 'match'
                        ? 'green'
                        : sos.address_match === 'mismatch'
                          ? 'red'
                          : 'amber'
                    }
                  >
                    {sos.address_match}
                  </Badge>
                ) : (
                  '—'
                )
              }
            />
          </dl>

          {sos.sos_officers && sos.sos_officers.length > 0 && (
            <div className="mt-3">
              <dt className="text-xs uppercase tracking-wide text-gray-500">Officers / Principals</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {sos.sos_officers.map((o, i) => (
                  <Badge key={i} tone="gray">
                    {o}
                  </Badge>
                ))}
              </dd>
            </div>
          )}

          {sos.risk_flags && sos.risk_flags.length > 0 && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
                Risk flags
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-red-700">
                {sos.risk_flags.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}

          {sos.mismatches && sos.mismatches.length > 0 && (
            <div className="mt-2 text-xs text-amber-700">
              Discrepancies: {sos.mismatches.join('; ')}
            </div>
          )}

          {sos.sos_summary && (
            <p className="mt-2 text-xs text-gray-500">{sos.sos_summary}</p>
          )}
          {sos.checked_at && (
            <p className="mt-1 text-xs text-gray-400">
              Checked {formatDateTime(sos.checked_at)}
              {sos.match_confidence ? ` · ${sos.match_confidence} confidence` : ''}
            </p>
          )}
        </>
      )}

      {/* Factor (payment recipient) — deduped across carriers */}
      {factor && (
        <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Factor
              </span>
              <span className="text-sm font-medium text-gray-900">{factor.name}</span>
              <Badge tone={factorTone(factor.approval_status)}>
                {factor.approval_status === 'approved'
                  ? 'Approved factor'
                  : factor.approval_status === 'rejected'
                    ? 'Rejected'
                    : 'Needs review'}
              </Badge>
              {factor.sos_status && (
                <Badge tone={statusTone(factor.sos_status_normalized)}>
                  SOS: {factor.sos_status}
                </Badge>
              )}
            </div>
            <Link
              href={factor.id ? `/factors/${factor.id}` : '/factors'}
              className="text-xs text-dts-blue hover:underline"
            >
              View factor →
            </Link>
          </div>
          {factor.sos_summary && (
            <p className="mt-1.5 text-xs text-gray-500">{factor.sos_summary}</p>
          )}
          <p className="mt-1 text-xs text-gray-400">
            {factor.sos_checked_at
              ? `SOS pulled ${formatDateTime(factor.sos_checked_at)}${
                  factor.sos_state ? ` · ${factor.sos_state}` : ''
                } · shared across carriers (not re-pulled)`
              : 'SOS not pulled yet'}
          </p>
        </div>
      )}
    </div>
  )
}
