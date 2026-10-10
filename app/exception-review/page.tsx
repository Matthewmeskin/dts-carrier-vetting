'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { PageHeader } from '@/components/ui/PageHeader'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { cn, formatDate, formatScore } from '@/lib/utils'

// Policy Section 8: approvers review all exception approvals at least
// quarterly. Each carrier shows who set the exception, when it was last
// reviewed, and whether a review is due. Recording a review writes it to the
// carrier's activity timeline, which is the record.

interface Row {
  dot: string
  name: string
  status: string | null
  section9: boolean
  gap: number | null
  setBy: string | null
  setAt: string | null
  setByApprover: boolean
  lastReviewedBy: string | null
  lastReviewedAt: string | null
  lastReviewNote: string | null
  due: boolean
}

export default function ExceptionReviewPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [canReview, setCanReview] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'due' | 'all'>('due')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/exception-review', { cache: 'no-store' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not load exceptions')
      setRows(d.rows ?? [])
      setCanReview(!!d.canReview)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load exceptions')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const due = rows.filter((r) => r.due).length
  const shown = filter === 'due' ? rows.filter((r) => r.due) : rows

  return (
    <div className="space-y-4">
      <PageHeader
        title="Exception review"
        subtitle="Every Exception Approved and Section 9 carrier. The policy says an approver reviews each one at least every quarter. Recording a review saves it to the carrier’s activity."
        action={
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm">
            {(['due', 'all'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn('rounded-md px-3 py-1', filter === f ? 'bg-white font-semibold shadow-sm' : 'text-gray-500')}
              >
                {f === 'due' ? `Due (${due})` : `All (${rows.length})`}
              </button>
            ))}
          </div>
        }
      />
      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : (
        <Card>
          <CardBody>
            {shown.length === 0 ? (
              <p className="text-sm text-green-700">Nothing due. Every exception has been reviewed this quarter.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Carrier</TH>
                      <TH>Type</TH>
                      <TH>Set by</TH>
                      <TH>Last review</TH>
                      <TH>Review</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {shown.map((r) => (
                      <ReviewRow key={r.dot} row={r} canReview={canReview} onDone={load} />
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  )
}

function ReviewRow({ row: r, canReview, onDone }: { row: Row; canReview: boolean; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  async function record(outcome: 'keep' | 'change') {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/exception-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dot: r.dot, outcome, note }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not record the review')
      setNote('')
      onDone()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not record the review')
    } finally {
      setBusy(false)
    }
  }
  return (
    <TR>
      <TD className="font-medium">
        <Link href={`/carriers/${r.dot}`} className="text-dts-blue hover:underline">{r.name}</Link>
        <div className="text-[11px] text-gray-400">DOT {r.dot}{r.gap != null ? ` · GAP ${formatScore(r.gap)}` : ''}</div>
      </TD>
      <TD>
        {r.section9 ? <Badge tone="blue">Section 9</Badge> : <Badge tone="amber">Exception</Badge>}
      </TD>
      <TD className="text-xs">
        {r.setBy ? (
          <>
            {r.setBy}
            <div className="text-gray-400">{r.setAt ? formatDate(r.setAt) : ''}</div>
            {!r.setByApprover && <div className="font-semibold text-red-600">Not set by an approver</div>}
          </>
        ) : (
          <span className="text-red-600">No sign off on record</span>
        )}
      </TD>
      <TD className="text-xs">
        {r.lastReviewedAt ? (
          <>
            {formatDate(r.lastReviewedAt)} · {r.lastReviewedBy}
            {r.lastReviewNote && <div className="text-gray-500">“{r.lastReviewNote}”</div>}
          </>
        ) : (
          <span className="text-gray-400">Never</span>
        )}
        {r.due && <div className="font-semibold text-amber-700">Review due</div>}
      </TD>
      <TD className="min-w-[220px]">
        {canReview ? (
          <div className="space-y-1">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (required if it needs a change)"
              className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
            />
            <div className="flex gap-1">
              <Button size="sm" disabled={busy} onClick={() => record('keep')}>Keep</Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => record('change')}>Needs change</Button>
            </div>
            {msg && <p className="text-[11px] text-red-700">{msg}</p>}
          </div>
        ) : (
          <span className="text-xs text-gray-400">Approvers only</span>
        )}
      </TD>
    </TR>
  )
}
