'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge, carrierStatusTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { ROLE_LABEL, roleCanApprove, type Role } from '@/lib/roles'
import type { ApprovalRequestRow } from '@/lib/approvals'
import { cn, formatDate, formatScore } from '@/lib/utils'

// Approval queue. Staff reviewers finish a vetting that trips a gate (GAP
// exception, additional vetting, Conditional/Unsatisfactory rating) and submit
// it; a Manager or Director reads the case here and either grants the approval
// — which applies the status and completes the vetting — or sends it back with
// a note. Everyone can see the queue; only a high-enough role gets the buttons.

const PT = 'America/Los_Angeles'
function fmtPacific(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    timeZone: PT,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function DecisionBox({
  row,
  onDone,
}: {
  row: ApprovalRequestRow
  onDone: () => void | Promise<void>
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'approved' | 'sent_back' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decide(decision: 'approved' | 'sent_back') {
    if (decision === 'sent_back' && !note.trim()) {
      setError('Add a note so the reviewer knows what to fix.')
      return
    }
    setBusy(decision)
    setError(null)
    try {
      const res = await fetch(`/api/approvals/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: note.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save the decision')
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the decision')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3">
      <Textarea
        label="Decision note (required to send back, optional to approve)"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Approved on the strength of the documented cargo COI; re-check at next re-vet."
      />
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => decide('approved')} disabled={busy !== null}>
          {busy === 'approved' ? <Spinner size={14} /> : null}
          Approve as {row.requested_status}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => decide('sent_back')}
          disabled={busy !== null}
        >
          {busy === 'sent_back' ? <Spinner size={14} /> : null}
          Send back to reviewer
        </Button>
      </div>
    </div>
  )
}

function RequestCard({
  row,
  role,
  onDone,
}: {
  row: ApprovalRequestRow
  role: Role | null
  onDone: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const canDecide = !!role && roleCanApprove(role, row.required_level) && !row.decided_at
  const c = row.carrier
  const hs = row.hard_stops ?? []
  const flags = row.flagged_scores ?? []
  const decided = !!row.decided_at

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/carriers/${row.dot_number}`}
                className="text-base font-semibold text-gray-900 hover:text-dts-blue hover:underline"
              >
                {c?.legal_name ?? `DOT ${row.dot_number}`}
              </Link>
              <Badge tone={row.required_level === 'director' ? 'red' : 'amber'}>
                Needs {ROLE_LABEL[row.required_level]}
              </Badge>
              <Badge tone="blue">Requested: {row.requested_status}</Badge>
              {c?.carrier_status && (
                <Badge tone={carrierStatusTone(c.carrier_status)}>Now: {c.carrier_status}</Badge>
              )}
              {decided && (
                <Badge tone={row.decision === 'approved' ? 'green' : 'gray'}>
                  {row.decision === 'approved' ? 'Approved' : 'Sent back'}
                </Badge>
              )}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              DOT {row.dot_number}
              {c?.mc_number ? ` · MC ${String(c.mc_number).replace(/\D/g, '')}` : ''}
              {c?.city || c?.state ? ` · ${[c?.city, c?.state].filter(Boolean).join(', ')}` : ''}
              {c?.safety_rating ? ` · Rating: ${c.safety_rating}` : ''}
              {c?.last_hauled_at ? ` · Last hauled ${formatDate(c.last_hauled_at)}` : ' · No DTS haul on record'}
            </div>
          </div>
          <div className="text-right text-xs text-gray-500">
            <div>
              Submitted {fmtPacific(row.requested_at)}
              <br />
              by {row.requested_by}
            </div>
            {decided && (
              <div className="mt-1">
                Decided {fmtPacific(row.decided_at)}
                <br />
                by {row.decided_by}
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-400">GAP score</div>
            <div
              className={cn(
                'text-lg font-bold',
                row.gap_score === null
                  ? 'text-gray-400'
                  : row.gap_score >= 65
                    ? 'text-green-700'
                    : row.gap_score >= 60
                      ? 'text-amber-600'
                      : 'text-red-600'
              )}
            >
              {row.gap_score === null ? '—' : formatScore(row.gap_score)}
            </div>
            {flags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {flags.map((f) => (
                  <Badge key={f} tone="amber">
                    {f}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="sm:col-span-2">
            <div className="text-[11px] uppercase tracking-wide text-gray-400">Why it needs sign-off</div>
            {hs.length > 0 ? (
              <ul className="mt-0.5 list-disc pl-5 text-red-700">
                {hs.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            ) : (
              <div className="mt-0.5 text-gray-600">
                {row.required_level === 'director'
                  ? 'GAP below 60 or a Conditional / Unsatisfactory safety rating.'
                  : 'GAP in the 60–64.99 exception band or a category at or below 30.'}
              </div>
            )}
          </div>
        </div>

        {(row.request_note || row.exception_note || row.internal_notes) && (
          <div className="mt-3 space-y-2 text-sm">
            {row.request_note && (
              <div>
                <span className="font-medium text-gray-700">Reviewer’s note: </span>
                <span className="text-gray-800">{row.request_note}</span>
              </div>
            )}
            {row.exception_note && (
              <div>
                <button
                  type="button"
                  onClick={() => setOpen((o) => !o)}
                  className="text-xs font-medium text-dts-blue hover:underline"
                >
                  {open ? 'Hide' : 'Show'} exception note
                </button>
                {open && (
                  <pre className="mt-1 whitespace-pre-wrap rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-800">
                    {row.exception_note}
                  </pre>
                )}
              </div>
            )}
            {row.internal_notes && open && (
              <div>
                <span className="font-medium text-gray-700">Internal notes: </span>
                <span className="text-gray-800">{row.internal_notes}</span>
              </div>
            )}
          </div>
        )}

        {decided && row.decision_note && (
          <div className="mt-3 text-sm">
            <span className="font-medium text-gray-700">Decision note: </span>
            <span className="text-gray-800">{row.decision_note}</span>
          </div>
        )}

        {canDecide && <DecisionBox row={row} onDone={onDone} />}
        {!decided && !canDecide && role && (
          <p className="mt-3 text-xs text-gray-500">
            Waiting on a {ROLE_LABEL[row.required_level]}. Your role ({ROLE_LABEL[role]}) can view but not decide this one.
          </p>
        )}
      </CardBody>
    </Card>
  )
}

export default function ApprovalsPage() {
  const [tab, setTab] = useState<'pending' | 'decided'>('pending')
  const [rows, setRows] = useState<ApprovalRequestRow[]>([])
  const [role, setRole] = useState<Role | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/approvals?state=${tab}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load the queue')
      setRows(data.requests ?? [])
      setRole(data.role ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the queue')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => {
    load()
  }, [load])

  const mine = role ? rows.filter((r) => roleCanApprove(role, r.required_level)) : []
  const others = role ? rows.filter((r) => !roleCanApprove(role, r.required_level)) : rows

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Approvals</h1>
          <p className="mt-1 text-sm text-gray-500">
            Carriers that tripped an approval gate and are waiting on a Manager or Director. Approving
            applies the status and completes the vetting; sending back returns it to the reviewer with a note.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-sm">
          {(['pending', 'decided'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'rounded px-3 py-1.5 transition',
                tab === t ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-600 hover:bg-gray-50'
              )}
            >
              {t === 'pending' ? 'Waiting' : 'Decided'}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
          <Spinner size={16} /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardBody>
            <p className="py-6 text-center text-sm text-gray-500">
              {tab === 'pending' ? 'Nothing waiting for approval.' : 'No decisions yet.'}
            </p>
          </CardBody>
        </Card>
      ) : tab === 'pending' && role ? (
        <>
          {mine.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                For you to decide ({mine.length})
              </h2>
              {mine.map((r) => (
                <RequestCard key={r.id} row={r} role={role} onDone={load} />
              ))}
            </section>
          )}
          {others.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                {mine.length > 0 ? 'Waiting on someone else' : 'Waiting for approval'} ({others.length})
              </h2>
              {others.map((r) => (
                <RequestCard key={r.id} row={r} role={role} onDone={load} />
              ))}
            </section>
          )}
        </>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <RequestCard key={r.id} row={r} role={role} onDone={load} />
          ))}
        </div>
      )}
    </div>
  )
}
