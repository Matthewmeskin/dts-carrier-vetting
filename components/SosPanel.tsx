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

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <label className={className}>
      <span className="mb-0.5 block text-xs font-medium text-gray-600">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
      />
    </label>
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
  // "Search a different name" — lets a reviewer look up the SOS registration
  // under the DBA or an owner's name when the FMCSA legal name doesn't match.
  const [showNameSearch, setShowNameSearch] = useState(false)
  const [searchName, setSearchName] = useState('')
  const [searchState, setSearchState] = useState('')
  // "Enter manually" — record the correct entity when a reviewer found it on the
  // state site but the automated search couldn't (or matched the wrong company).
  const [showManual, setShowManual] = useState(false)
  const [savingManual, setSavingManual] = useState(false)
  const [manual, setManual] = useState({
    entity_name: '',
    state: '',
    entity_id: '',
    status: '',
    entity_type: '',
    formation_date: '',
    registered_agent: '',
    principal_address: '',
    source_url: '',
    notes: '',
  })
  const setM = (k: keyof typeof manual, v: string) =>
    setManual((m) => ({ ...m, [k]: v }))
  // Paste-and-parse: paste the record copied off the state site and let AI fill
  // the fields, which the reviewer then confirms before saving.
  const [pasteText, setPasteText] = useState('')
  const [parsing, setParsing] = useState(false)

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

  async function run(fresh: boolean, overrides?: { name?: string; state?: string }) {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch(`/api/carriers/${dot}/sos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fresh,
          ...(overrides?.name ? { name: overrides.name } : {}),
          ...(overrides?.state ? { state: overrides.state } : {}),
        }),
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

  async function parsePaste() {
    if (!pasteText.trim()) return
    setParsing(true)
    setError(null)
    try {
      const res = await fetch(`/api/carriers/${dot}/sos/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteText }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Parse failed (${res.status})`)
      const p = data.parsed || {}
      // Fill only the fields the parser found; keep anything already typed.
      setManual((m) => ({
        entity_name: p.entity_name || m.entity_name,
        state: (p.state || m.state || '').toUpperCase().slice(0, 2),
        entity_id: p.entity_id || m.entity_id,
        status: p.status || m.status,
        entity_type: p.entity_type || m.entity_type,
        formation_date: p.formation_date || m.formation_date,
        registered_agent: p.registered_agent || m.registered_agent,
        principal_address: p.principal_address || m.principal_address,
        source_url: p.source_url || m.source_url,
        notes: m.notes,
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Parse failed')
    } finally {
      setParsing(false)
    }
  }

  async function saveManual() {
    if (!manual.entity_name.trim() || !manual.state.trim()) {
      setError('Enter at least the entity name and state.')
      return
    }
    setSavingManual(true)
    setError(null)
    try {
      const res = await fetch(`/api/carriers/${dot}/sos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manual),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`)
      setShowManual(false)
      await onRefreshed?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingManual(false)
    }
  }

  async function markNotFound() {
    if (
      !window.confirm(
        'Mark this carrier as “unable to find SOS data”? Record that you searched the state site and no registration could be located.'
      )
    )
      return
    setSavingManual(true)
    setError(null)
    try {
      const res = await fetch(`/api/carriers/${dot}/sos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          not_found: true,
          entity_name: manual.entity_name.trim() || searchName.trim() || undefined,
          state: manual.state.trim() || searchState.trim() || undefined,
          notes: manual.notes.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`)
      setShowManual(false)
      await onRefreshed?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingManual(false)
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
  // A human-recorded "searched, nothing found" state (distinct from never-checked).
  const isNotFound = (activeSos as any)?.match_confidence === 'not_found'

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
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowNameSearch((v) => !v)}
              disabled={running}
            >
              Search a different name
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                // Prefill the manual form's name/state from any name-search inputs.
                setManual((m) => ({
                  ...m,
                  entity_name: m.entity_name || searchName,
                  state: m.state || searchState,
                }))
                setShowManual((v) => !v)
              }}
              disabled={running}
            >
              Enter manually
            </Button>
            {!isNotFound && (
              <Button
                size="sm"
                variant="ghost"
                onClick={markNotFound}
                disabled={running || savingManual}
                className="text-amber-700 hover:bg-amber-50"
              >
                Unable to find
              </Button>
            )}
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

      {configured && showNameSearch && (
        <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
          <p className="mb-2 text-xs text-gray-600">
            Search the Secretary of State under a different name — e.g. the DBA or
            an owner’s name for a sole proprietor. Leave state blank to use the
            carrier’s domicile state.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1">
              <span className="mb-0.5 block text-xs font-medium text-gray-600">
                Name to search
              </span>
              <input
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                placeholder="e.g. GM Transport or Jose Guzman"
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="w-20">
              <span className="mb-0.5 block text-xs font-medium text-gray-600">
                State
              </span>
              <input
                value={searchState}
                onChange={(e) => setSearchState(e.target.value.toUpperCase().slice(0, 2))}
                placeholder="NV"
                maxLength={2}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm uppercase"
              />
            </label>
            <Button
              size="sm"
              onClick={() =>
                run(true, {
                  name: searchName.trim() || undefined,
                  state: searchState.trim() || undefined,
                })
              }
              disabled={running || !searchName.trim()}
            >
              {running ? 'Searching…' : 'Search'}
            </Button>
          </div>
        </div>
      )}

      {configured && showManual && (
        <div className="mb-3 rounded-md border border-dts-blue/30 bg-dts-blue/5 px-3 py-2.5">
          <p className="mb-2 text-xs text-gray-600">
            Found the right entity on the state site but the automated search
            couldn’t? Paste the record below and click <b>Parse</b> to auto-fill
            the fields, or type them in. Saved as a manual, human-verified match.
            Only the name and state are required.
          </p>
          <div className="mb-2 rounded-md border border-gray-200 bg-white px-2.5 py-2">
            <span className="mb-0.5 block text-xs font-medium text-gray-600">
              Paste from the state site
            </span>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={3}
              placeholder="Copy the entity record (name, status, entity ID, agent, address…) and paste it here"
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={parsePaste} disabled={parsing || !pasteText.trim()}>
                {parsing ? 'Parsing…' : 'Parse & fill fields'}
              </Button>
              <span className="text-xs text-gray-400">Review the fields below before saving.</span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <FieldInput label="Entity name (as registered) *" value={manual.entity_name} onChange={(v) => setM('entity_name', v)} placeholder="e.g. GM TRANSPORT LLC" />
            <FieldInput label="State *" value={manual.state} onChange={(v) => setM('state', v.toUpperCase().slice(0, 2))} placeholder="NV" />
            <FieldInput label="State entity ID" value={manual.entity_id} onChange={(v) => setM('entity_id', v)} />
            <FieldInput label="Status" value={manual.status} onChange={(v) => setM('status', v)} placeholder="Active / Good Standing" />
            <FieldInput label="Entity type" value={manual.entity_type} onChange={(v) => setM('entity_type', v)} placeholder="Domestic LLC" />
            <FieldInput label="Formation date" value={manual.formation_date} onChange={(v) => setM('formation_date', v)} placeholder="YYYY-MM-DD" />
            <FieldInput label="Registered agent" value={manual.registered_agent} onChange={(v) => setM('registered_agent', v)} />
            <FieldInput label="Principal address" value={manual.principal_address} onChange={(v) => setM('principal_address', v)} />
            <FieldInput label="Source URL (state record link)" value={manual.source_url} onChange={(v) => setM('source_url', v)} className="sm:col-span-2" placeholder="https://…" />
            <FieldInput label="Notes" value={manual.notes} onChange={(v) => setM('notes', v)} className="sm:col-span-2" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" onClick={saveManual} disabled={savingManual || !manual.entity_name.trim() || !manual.state.trim()}>
              {savingManual ? 'Saving…' : 'Save manual entry'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowManual(false)} disabled={savingManual}>
              Cancel
            </Button>
          </div>
        </div>
      )}

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

      {activeSos && isNotFound && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
          <div>
            <Badge tone="amber">Unable to find SOS record</Badge>
            <p className="mt-1 text-xs text-amber-800">
              {(activeSos as any).sos_summary || 'Searched — no SOS record found.'}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={remove} disabled={removing} className="text-gray-600">
            {removing ? 'Clearing…' : 'Clear'}
          </Button>
        </div>
      )}

      {sos && !removed && !isNotFound && (
        <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field
              label="Entity Name (SOS)"
              value={
                (sos as any).sos_entity_name ||
                (sos as any).sos_search_name ||
                '—'
              }
            />
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
