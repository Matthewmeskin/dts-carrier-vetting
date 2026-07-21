'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { formatDateTime } from '@/lib/utils'

interface Row {
  id: string
  dot_number: string | null
  carrier_name: string | null
  event_type: string
  summary: string | null
  actor: string | null
  created_at: string
}

const TYPE_META: Record<string, { label: string; tone: BadgeTone }> = {
  vetting_saved: { label: 'Vetting', tone: 'green' },
  status_change: { label: 'Status', tone: 'blue' },
  checklist_change: { label: 'Checklist', tone: 'blue' },
  document_upload: { label: 'Document', tone: 'blue' },
  recertification: { label: 'Recertified', tone: 'green' },
  score_flag: { label: 'Score flag', tone: 'amber' },
  hard_stop: { label: 'Hard stop', tone: 'red' },
  insurance_change: { label: 'Insurance', tone: 'amber' },
  eld_flag: { label: 'ELD', tone: 'red' },
  sos_check: { label: 'SOS', tone: 'gray' },
  noa_check: { label: 'NOA', tone: 'blue' },
}

function meta(type: string) {
  return TYPE_META[type] ?? { label: type, tone: 'gray' as BadgeTone }
}

// A human actor is stamped "Name (Staff|Manager|Director)"; automated actors are
// things like "ELD monitor", "system (RMIS delta)", "Bluewire upload".
function isPerson(actor: string | null): boolean {
  return !!actor && /\((Staff|Manager|Director)\)\s*$/.test(actor)
}

export default function ActivityLogPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [actor, setActor] = useState('')
  const [peopleOnly, setPeopleOnly] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [actors, setActors] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ date })
      if (actor) qs.set('actor', actor)
      const res = await fetch(`/api/activity?${qs.toString()}`, { cache: 'no-store' })
      const data = await res.json()
      if (res.ok) {
        setRows(data.events ?? [])
        setActors(data.actors ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [date, actor])

  useEffect(() => {
    load()
  }, [load])

  const visibleRows = useMemo(
    () => (peopleOnly ? rows.filter((r) => isPerson(r.actor)) : rows),
    [rows, peopleOnly]
  )

  // Per-actor counts for the selected day, over the current (People/All) view.
  const summary = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of visibleRows) {
      const a = r.actor || 'system'
      m.set(a, (m.get(a) ?? 0) + 1)
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [visibleRows])

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">User Activity Log</h1>
        <Link href="/carriers" className="text-sm font-medium text-dts-blue hover:underline">
          ← Carriers
        </Link>
      </div>

      <Card>
        <CardHeader
          title="Actions by day"
          subtitle="Who did what, across all carriers. Times are UTC."
          action={
            <div className="flex items-end gap-3">
              <div className="flex rounded-md border border-gray-200 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setPeopleOnly(false)}
                  className={`rounded px-2.5 py-1 font-medium ${!peopleOnly ? 'bg-dts-blue text-white' : 'text-gray-600'}`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setPeopleOnly(true)}
                  className={`rounded px-2.5 py-1 font-medium ${peopleOnly ? 'bg-dts-blue text-white' : 'text-gray-600'}`}
                >
                  People only
                </button>
              </div>
              <div className="w-40">
                <Input
                  label="Date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="w-56">
                <Select label="User" value={actor} onChange={(e) => setActor(e.target.value)}>
                  <option value="">All users</option>
                  {actors.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          }
        />
        <CardBody>
          {!loading && summary.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {summary.map(([a, n]) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setActor(a === actor ? '' : a)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    a === actor
                      ? 'border-dts-blue bg-dts-blue/10 text-dts-blue'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {a} · {n}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Spinner size={16} /> Loading…
            </div>
          ) : visibleRows.length === 0 ? (
            <p className="text-sm text-gray-500">
              {peopleOnly
                ? 'No user actions on this date (only automated activity).'
                : 'No recorded actions on this date.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">User</th>
                    <th className="py-2 pr-3 font-medium">Action</th>
                    <th className="py-2 pr-3 font-medium">Carrier</th>
                    <th className="py-2 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => {
                    const m = meta(r.event_type)
                    return (
                      <tr key={r.id} className="border-b border-gray-100 align-top">
                        <td className="whitespace-nowrap py-2 pr-3 text-xs text-gray-500">
                          {formatDateTime(r.created_at)}
                        </td>
                        <td className="py-2 pr-3 text-gray-800">{r.actor || 'system'}</td>
                        <td className="py-2 pr-3">
                          <Badge tone={m.tone}>{m.label}</Badge>
                        </td>
                        <td className="whitespace-nowrap py-2 pr-3">
                          {r.dot_number ? (
                            <Link
                              href={`/carriers/${r.dot_number}`}
                              className="text-dts-blue hover:underline"
                            >
                              {r.carrier_name || `DOT ${r.dot_number}`}
                            </Link>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="py-2 text-gray-700">{r.summary}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
