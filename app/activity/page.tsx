'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
const PT = 'America/Los_Angeles'
/** Today's date (YYYY-MM-DD) in Pacific. */
function pacificToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: PT })
}
/** Format an ISO timestamp in Pacific, e.g. "Jul 21, 2026 3:31 PM". */
function fmtPacific(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    timeZone: PT,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

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

/** Date (YYYY-MM-DD) N days before Pacific today. */
function pacificDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toLocaleDateString('en-CA', { timeZone: PT })
}

interface DisabledRow {
  dot_number: string | null
  carrier_name: string | null
  disabled_at: string | null
  source: 'brokerware' | 'manual'
  status: string | null
  reason: string | null
}

const DISABLED_PRESETS: { key: string; label: string; days: number }[] = [
  { key: 'd7', label: 'Last 7 days', days: 7 },
  { key: 'd30', label: 'Last 30 days', days: 30 },
  { key: 'd90', label: 'Last 90 days', days: 90 },
]

// A human actor is stamped "Name (Staff|Manager|Director)"; automated actors are
// things like "ELD monitor", "system (RMIS delta)", "Bluewire upload".
function isPerson(actor: string | null): boolean {
  return !!actor && /\((Staff|Manager|Director)\)\s*$/.test(actor)
}

interface HeldRow {
  dot_number: string
  carrier_name: string | null
  held_at: string
  note: string | null
  actor: string | null
}

interface DeclinedRow {
  dot_number: string
  carrier_name: string | null
  declined_at: string
  note: string | null
  actor: string | null
}

export default function ActivityLogPage() {
  const [view, setView] = useState<
    'activity' | 'disabled' | 'onhold' | 'declined'
  >('activity')
  const [date, setDate] = useState(pacificToday)
  const [actor, setActor] = useState('')
  const [peopleOnly, setPeopleOnly] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [actors, setActors] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  // Disabled-carriers panel state.
  const [dPreset, setDPreset] = useState('d30')
  const [dFrom, setDFrom] = useState(() => pacificDaysAgo(30))
  const [dTo, setDTo] = useState(pacificToday)
  const [dRows, setDRows] = useState<DisabledRow[]>([])
  const [dLoading, setDLoading] = useState(false)

  // On-hold-carriers panel state.
  const [hPreset, setHPreset] = useState('d30')
  const [hFrom, setHFrom] = useState(() => pacificDaysAgo(30))
  const [hTo, setHTo] = useState(pacificToday)
  const [hRows, setHRows] = useState<HeldRow[]>([])
  const [hLoading, setHLoading] = useState(false)

  // Declined-carriers panel state.
  const [xPreset, setXPreset] = useState('d30')
  const [xFrom, setXFrom] = useState(() => pacificDaysAgo(30))
  const [xTo, setXTo] = useState(pacificToday)
  const [xRows, setXRows] = useState<DeclinedRow[]>([])
  const [xLoading, setXLoading] = useState(false)

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

  const loadDisabled = useCallback(async () => {
    setDLoading(true)
    try {
      const qs = new URLSearchParams()
      if (dFrom) qs.set('from', dFrom)
      if (dTo) qs.set('to', dTo)
      const res = await fetch(`/api/activity/disabled?${qs.toString()}`, {
        cache: 'no-store',
      })
      const data = await res.json()
      if (res.ok) setDRows(data.carriers ?? [])
    } finally {
      setDLoading(false)
    }
  }, [dFrom, dTo])

  useEffect(() => {
    if (view === 'disabled') loadDisabled()
  }, [view, loadDisabled])

  function applyDisabledPreset(key: string, days: number) {
    setDPreset(key)
    setDFrom(pacificDaysAgo(days))
    setDTo(pacificToday())
  }

  const loadHeld = useCallback(async () => {
    setHLoading(true)
    try {
      const qs = new URLSearchParams()
      if (hFrom) qs.set('from', hFrom)
      if (hTo) qs.set('to', hTo)
      const res = await fetch(`/api/activity/on-hold?${qs.toString()}`, {
        cache: 'no-store',
      })
      const data = await res.json()
      if (res.ok) setHRows(data.carriers ?? [])
    } finally {
      setHLoading(false)
    }
  }, [hFrom, hTo])

  useEffect(() => {
    if (view === 'onhold') loadHeld()
  }, [view, loadHeld])

  function applyHeldPreset(key: string, days: number) {
    setHPreset(key)
    setHFrom(pacificDaysAgo(days))
    setHTo(pacificToday())
  }

  const loadDeclined = useCallback(async () => {
    setXLoading(true)
    try {
      const qs = new URLSearchParams()
      if (xFrom) qs.set('from', xFrom)
      if (xTo) qs.set('to', xTo)
      const res = await fetch(`/api/activity/declined?${qs.toString()}`, {
        cache: 'no-store',
      })
      const data = await res.json()
      if (res.ok) setXRows(data.carriers ?? [])
    } finally {
      setXLoading(false)
    }
  }, [xFrom, xTo])

  useEffect(() => {
    if (view === 'declined') loadDeclined()
  }, [view, loadDeclined])

  function applyDeclinedPreset(key: string, days: number) {
    setXPreset(key)
    setXFrom(pacificDaysAgo(days))
    setXTo(pacificToday())
  }

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

      <div className="mb-4 flex rounded-md border border-gray-200 p-0.5 text-sm w-fit">
        <button
          type="button"
          onClick={() => setView('activity')}
          className={`rounded px-3 py-1.5 font-medium ${view === 'activity' ? 'bg-dts-blue text-white' : 'text-gray-600'}`}
        >
          Daily activity
        </button>
        <button
          type="button"
          onClick={() => setView('disabled')}
          className={`rounded px-3 py-1.5 font-medium ${view === 'disabled' ? 'bg-dts-blue text-white' : 'text-gray-600'}`}
        >
          Disabled carriers
        </button>
        <button
          type="button"
          onClick={() => setView('onhold')}
          className={`rounded px-3 py-1.5 font-medium ${view === 'onhold' ? 'bg-dts-blue text-white' : 'text-gray-600'}`}
        >
          On hold
        </button>
        <button
          type="button"
          onClick={() => setView('declined')}
          className={`rounded px-3 py-1.5 font-medium ${view === 'declined' ? 'bg-dts-blue text-white' : 'text-gray-600'}`}
        >
          Declined
        </button>
      </div>

      {view === 'disabled' ? (
        <Card>
          <CardHeader
            title="Disabled carriers"
            subtitle="Carriers disabled in Brokerware or manually marked do-not-use, by when they were disabled. Times are Pacific (PT)."
            action={
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex rounded-md border border-gray-200 p-0.5 text-xs">
                  {DISABLED_PRESETS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => applyDisabledPreset(p.key, p.days)}
                      className={`rounded px-2.5 py-1 font-medium ${dPreset === p.key ? 'bg-dts-blue text-white' : 'text-gray-600'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="w-36">
                  <Input
                    label="From"
                    type="date"
                    value={dFrom}
                    onChange={(e) => {
                      setDFrom(e.target.value)
                      setDPreset('')
                    }}
                  />
                </div>
                <div className="w-36">
                  <Input
                    label="To"
                    type="date"
                    value={dTo}
                    onChange={(e) => {
                      setDTo(e.target.value)
                      setDPreset('')
                    }}
                  />
                </div>
              </div>
            }
          />
          <CardBody>
            {dLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Spinner size={16} /> Loading…
              </div>
            ) : dRows.length === 0 ? (
              <p className="text-sm text-gray-500">
                No carriers were disabled in this range.
              </p>
            ) : (
              <>
                <p className="mb-3 text-xs text-gray-500">
                  {dRows.length} carrier{dRows.length === 1 ? '' : 's'} disabled in this range.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                        <th className="py-2 pr-3 font-medium">Disabled</th>
                        <th className="py-2 pr-3 font-medium">Carrier</th>
                        <th className="py-2 pr-3 font-medium">Source</th>
                        <th className="py-2 font-medium">Status / reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dRows.map((r) => (
                        <tr
                          key={`${r.source}-${r.dot_number}`}
                          className="border-b border-gray-100 align-top"
                        >
                          <td className="whitespace-nowrap py-2 pr-3 text-xs text-gray-500">
                            {r.disabled_at ? fmtPacific(r.disabled_at) : '—'}
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
                          <td className="py-2 pr-3">
                            <Badge tone={r.source === 'manual' ? 'red' : 'amber'}>
                              {r.source === 'manual' ? 'Do-not-use' : 'Brokerware'}
                            </Badge>
                          </td>
                          <td className="py-2 text-gray-700">
                            {r.status || r.reason || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      ) : view === 'onhold' ? (
        <Card>
          <CardHeader
            title="Carriers put on hold"
            subtitle="Carriers placed On Hold in the portal, by when they were held. Times are Pacific (PT)."
            action={
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex rounded-md border border-gray-200 p-0.5 text-xs">
                  {DISABLED_PRESETS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => applyHeldPreset(p.key, p.days)}
                      className={`rounded px-2.5 py-1 font-medium ${hPreset === p.key ? 'bg-dts-blue text-white' : 'text-gray-600'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="w-36">
                  <Input
                    label="From"
                    type="date"
                    value={hFrom}
                    onChange={(e) => {
                      setHFrom(e.target.value)
                      setHPreset('')
                    }}
                  />
                </div>
                <div className="w-36">
                  <Input
                    label="To"
                    type="date"
                    value={hTo}
                    onChange={(e) => {
                      setHTo(e.target.value)
                      setHPreset('')
                    }}
                  />
                </div>
              </div>
            }
          />
          <CardBody>
            {hLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Spinner size={16} /> Loading…
              </div>
            ) : hRows.length === 0 ? (
              <p className="text-sm text-gray-500">
                No carriers were put on hold in this range.
              </p>
            ) : (
              <>
                <p className="mb-3 text-xs text-gray-500">
                  {hRows.length} carrier{hRows.length === 1 ? '' : 's'} put on hold in this range.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                        <th className="py-2 pr-3 font-medium">Held</th>
                        <th className="py-2 pr-3 font-medium">Carrier</th>
                        <th className="py-2 pr-3 font-medium">By</th>
                        <th className="py-2 font-medium">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hRows.map((r) => (
                        <tr
                          key={r.dot_number}
                          className="border-b border-gray-100 align-top"
                        >
                          <td className="whitespace-nowrap py-2 pr-3 text-xs text-gray-500">
                            {fmtPacific(r.held_at)}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-3">
                            <Link
                              href={`/carriers/${r.dot_number}`}
                              className="text-dts-blue hover:underline"
                            >
                              {r.carrier_name || `DOT ${r.dot_number}`}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap py-2 pr-3 text-gray-600">
                            {r.actor || 'system'}
                          </td>
                          <td className="py-2 text-gray-700">{r.note || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      ) : view === 'declined' ? (
        <Card>
          <CardHeader
            title="Declined carriers"
            subtitle="Carriers marked Declined in the portal, by when they were declined. Times are Pacific (PT)."
            action={
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex rounded-md border border-gray-200 p-0.5 text-xs">
                  {DISABLED_PRESETS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => applyDeclinedPreset(p.key, p.days)}
                      className={`rounded px-2.5 py-1 font-medium ${xPreset === p.key ? 'bg-dts-blue text-white' : 'text-gray-600'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="w-36">
                  <Input
                    label="From"
                    type="date"
                    value={xFrom}
                    onChange={(e) => {
                      setXFrom(e.target.value)
                      setXPreset('')
                    }}
                  />
                </div>
                <div className="w-36">
                  <Input
                    label="To"
                    type="date"
                    value={xTo}
                    onChange={(e) => {
                      setXTo(e.target.value)
                      setXPreset('')
                    }}
                  />
                </div>
              </div>
            }
          />
          <CardBody>
            {xLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Spinner size={16} /> Loading…
              </div>
            ) : xRows.length === 0 ? (
              <p className="text-sm text-gray-500">
                No carriers were declined in this range.
              </p>
            ) : (
              <>
                <p className="mb-3 text-xs text-gray-500">
                  {xRows.length} carrier{xRows.length === 1 ? '' : 's'} declined in this range.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                        <th className="py-2 pr-3 font-medium">Declined</th>
                        <th className="py-2 pr-3 font-medium">Carrier</th>
                        <th className="py-2 pr-3 font-medium">By</th>
                        <th className="py-2 font-medium">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {xRows.map((r) => (
                        <tr
                          key={r.dot_number}
                          className="border-b border-gray-100 align-top"
                        >
                          <td className="whitespace-nowrap py-2 pr-3 text-xs text-gray-500">
                            {fmtPacific(r.declined_at)}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-3">
                            <Link
                              href={`/carriers/${r.dot_number}`}
                              className="text-dts-blue hover:underline"
                            >
                              {r.carrier_name || `DOT ${r.dot_number}`}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap py-2 pr-3 text-gray-600">
                            {r.actor || 'system'}
                          </td>
                          <td className="py-2 text-gray-700">{r.note || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      ) : (
      <Card>
        <CardHeader
          title="Actions by day"
          subtitle="Who did what, across all carriers. Times are Pacific (PT)."
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
                          {fmtPacific(r.created_at)}
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
      )}
    </div>
  )
}
