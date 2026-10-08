'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { ROLE_LABEL } from '@/lib/roles'
import type { CarrierSummary } from '@/lib/types'
import { computeRevetStatus, isBrokerwareDisabled } from '@/lib/revet'
import {
  LETTERS,
  letterHistogram,
  memberInitials,
  memberName,
  suggestLetterRanges,
  type TeamMember,
} from '@/lib/assignments'
import { cn } from '@/lib/utils'

// Who works which carriers. Everyone sees the workload; managers and
// directors hand carriers out — evenly, so many each, or by letter range —
// and move a whole book from one person to another.

type Member = TeamMember & { assigned: number }
type Scope = 'active' | 'all'
type Pool = 'unassigned' | 'everyone' | 'from'
type Method = 'even' | 'count' | 'alphabet'

interface PreviewBucket {
  assigneeId: string
  name: string
  count: number
  first: string | null
  last: string | null
  letters: string
}

const DECLINED = new Set(['Declined', 'Do Not Use', 'Suspended'])

function isActive(c: CarrierSummary): boolean {
  return (
    !isBrokerwareDisabled(c.brokerware_status) &&
    (c.brokerware_status == null || c.brokerware_status.trim().toLowerCase() === 'active')
  )
}
function inScope(c: CarrierSummary, scope: Scope): boolean {
  if (c.do_not_use || DECLINED.has(c.carrier_status ?? '')) return false
  return scope === 'all' || isActive(c)
}

export default function AssignmentsPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [me, setMe] = useState<{ id: string; role: string } | null>(null)
  const [carriers, setCarriers] = useState<CarrierSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [tRes, cRes] = await Promise.all([
        fetch('/api/team', { cache: 'no-store' }),
        fetch('/api/carriers', { cache: 'no-store' }),
      ])
      const t = await tRes.json()
      const c = await cRes.json()
      if (!tRes.ok) throw new Error(t.error || 'Could not load the team')
      if (!cRes.ok) throw new Error(c.error || 'Could not load carriers')
      setMembers(t.members ?? [])
      setMe(t.me ?? null)
      setCarriers(c.carriers ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const isManager = me?.role === 'manager' || me?.role === 'director'

  // Workload per person over the active roster (what people actually work).
  const workload = useMemo(() => {
    const active = carriers.filter((c) => inScope(c, 'active'))
    const rows = new Map<string, { total: number; review: number; stops: number; overdue: number }>()
    const bump = (id: string, c: CarrierSummary) => {
      const r = rows.get(id) ?? { total: 0, review: 0, stops: 0, overdue: 0 }
      r.total += 1
      if (c.carrier_status === 'Pending Review' || c.requires_revetting) r.review += 1
      if ((c.hard_stops?.length ?? 0) > 0 && c.carrier_status !== 'Exception Approved') r.stops += 1
      const rv = computeRevetStatus(c.last_reviewed, c.created_at, c.revet_interval_days, c.revet_due_override)
      if (rv.state === 'overdue') r.overdue += 1
      rows.set(id, r)
    }
    for (const c of active) bump(c.assignee_id ?? 'none', c)
    return { rows, activeTotal: active.length }
  }, [carriers])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-lg font-semibold text-ink sm:text-xl">Assignments</h1>
        <p className="text-sm text-gray-500">
          Every carrier can have one owner: the person responsible for keeping its vetting current.
          Owners see their carriers by setting the Carriers list filter to <span className="font-medium text-gray-700">Assigned to: Me</span>.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Spinner /> Loading…
        </div>
      ) : (
        <>
          {isManager && <Distribute members={members} carriers={carriers} onApplied={load} />}
          <WorkloadTable
            members={members}
            me={me}
            isManager={isManager}
            workload={workload}
            carriers={carriers}
            onChanged={load}
          />
        </>
      )}
    </div>
  )
}

function WorkloadTable({
  members,
  me,
  isManager,
  workload,
  carriers,
  onChanged,
}: {
  members: Member[]
  me: { id: string; role: string } | null
  isManager: boolean
  workload: { rows: Map<string, { total: number; review: number; stops: number; overdue: number }>; activeTotal: number }
  carriers: CarrierSummary[]
  onChanged: () => Promise<void>
}) {
  const [transferFrom, setTransferFrom] = useState<string | null>(null)
  const [transferTo, setTransferTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function post(dots: string[], assigneeId: string | null) {
    const res = await fetch('/api/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dots, assigneeId }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(d.error || 'Could not update assignments')
    return d
  }

  async function transfer() {
    if (!transferFrom || !transferTo) return
    const dots = carriers.filter((c) => c.assignee_id === transferFrom).map((c) => c.dot_number)
    if (dots.length === 0) return
    const target = transferTo === 'none' ? null : transferTo
    const toName = target ? memberName(members.find((m) => m.id === target)) : 'nobody (unassigned)'
    if (!window.confirm(`Move all ${dots.length} of ${memberName(members.find((m) => m.id === transferFrom))}'s carriers to ${toName}?`)) return
    setBusy(true)
    setMsg(null)
    try {
      await post(dots, target)
      setMsg(`Moved ${dots.length} carrier(s) to ${toName}.`)
      setTransferFrom(null)
      setTransferTo('')
      await onChanged()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not move carriers')
    } finally {
      setBusy(false)
    }
  }

  const unassigned = workload.rows.get('none') ?? { total: 0, review: 0, stops: 0, overdue: 0 }
  const allOwned = carriers.filter((c) => c.assignee_id).length

  return (
    <Card>
      <CardHeader
        title="Workload"
        subtitle={`${workload.activeTotal} active carriers · ${allOwned} assigned overall`}
      />
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-5 py-2">Person</th>
                <th className="px-3 py-2 text-right">Active carriers</th>
                <th className="px-3 py-2 text-right">Needs review</th>
                <th className="px-3 py-2 text-right">Open hard stops</th>
                <th className="px-3 py-2 text-right">Re-vet overdue</th>
                <th className="px-5 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const r = workload.rows.get(m.id) ?? { total: 0, review: 0, stops: 0, overdue: 0 }
                const name = memberName(m)
                const mine = me?.id === m.id
                return (
                  <tr key={m.id} className="border-b border-gray-100">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
                            mine ? 'bg-maroon text-white' : 'bg-gray-200 text-gray-700'
                          )}
                        >
                          {memberInitials(name)}
                        </span>
                        <div>
                          <div className="font-medium text-gray-900">
                            {name}
                            {mine ? ' (me)' : ''}
                          </div>
                          <div className="text-[11px] uppercase tracking-wide text-gray-400">{ROLE_LABEL[m.role] ?? m.role}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-gray-900">{r.total}</td>
                    <td className={cn('px-3 py-2.5 text-right', r.review ? 'text-amber-700' : 'text-gray-400')}>{r.review}</td>
                    <td className={cn('px-3 py-2.5 text-right', r.stops ? 'text-red-700' : 'text-gray-400')}>{r.stops}</td>
                    <td className={cn('px-3 py-2.5 text-right', r.overdue ? 'text-red-700' : 'text-gray-400')}>{r.overdue}</td>
                    <td className="px-5 py-2.5 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Link href={`/carriers?assignee=${m.id}`} className="text-dts-blue hover:underline">
                          View
                        </Link>
                        {isManager && transferFrom === m.id ? (
                          <>
                            <select
                              value={transferTo}
                              onChange={(e) => setTransferTo(e.target.value)}
                              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
                            >
                              <option value="">Move all to…</option>
                              {members
                                .filter((x) => x.id !== m.id)
                                .map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {memberName(x)}
                                  </option>
                                ))}
                              <option value="none">Unassign all</option>
                            </select>
                            <Button size="sm" variant="primary" onClick={transfer} disabled={busy || !transferTo}>
                              Move
                            </Button>
                            <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => setTransferFrom(null)}>
                              Cancel
                            </button>
                          </>
                        ) : isManager && m.assigned > 0 ? (
                          <button
                            type="button"
                            className="text-xs text-gray-600 hover:underline"
                            onClick={() => {
                              setTransferFrom(m.id)
                              setTransferTo('')
                            }}
                          >
                            Move all…
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
              <tr className="bg-gray-50">
                <td className="px-5 py-2.5 text-gray-600">Unassigned</td>
                <td className="px-3 py-2.5 text-right font-medium text-gray-900">{unassigned.total}</td>
                <td className={cn('px-3 py-2.5 text-right', unassigned.review ? 'text-amber-700' : 'text-gray-400')}>{unassigned.review}</td>
                <td className={cn('px-3 py-2.5 text-right', unassigned.stops ? 'text-red-700' : 'text-gray-400')}>{unassigned.stops}</td>
                <td className={cn('px-3 py-2.5 text-right', unassigned.overdue ? 'text-red-700' : 'text-gray-400')}>{unassigned.overdue}</td>
                <td className="px-5 py-2.5 text-right">
                  <Link href="/carriers?assignee=none" className="text-dts-blue hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {msg && <p className="px-5 py-3 text-sm text-gray-700">{msg}</p>}
      </CardBody>
    </Card>
  )
}

function Distribute({
  members,
  carriers,
  onApplied,
}: {
  members: Member[]
  carriers: CarrierSummary[]
  onApplied: () => Promise<void>
}) {
  const [scope, setScope] = useState<Scope>('active')
  const [pool, setPool] = useState<Pool>('unassigned')
  const [fromId, setFromId] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [method, setMethod] = useState<Method>('even')
  const [count, setCount] = useState(25)
  const [ranges, setRanges] = useState<Record<string, { from: string; to: string }>>({})
  const [preview, setPreview] = useState<{ poolSize: number; assigned: number; leftover: number; buckets: PreviewBucket[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  // The pool as the server will see it, so counts and letter suggestions are live.
  const poolRows = useMemo(
    () =>
      carriers.filter((c) => {
        if (!inScope(c, scope)) return false
        if (pool === 'unassigned') return !c.assignee_id
        if (pool === 'from') return !!fromId && c.assignee_id === fromId
        return true
      }),
    [carriers, scope, pool, fromId]
  )
  const histogram = useMemo(() => letterHistogram(poolRows), [poolRows])
  const rangeCount = useCallback(
    (from: string, to: string) => {
      const a = LETTERS.indexOf(from)
      const b = LETTERS.indexOf(to)
      if (a < 0 || b < 0) return 0
      let n = 0
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) n += histogram[LETTERS[i]] ?? 0
      return n
    },
    [histogram]
  )

  function togglePerson(id: string) {
    setPreview(null)
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }

  function suggest() {
    const s = suggestLetterRanges(histogram, picked.length)
    const next: Record<string, { from: string; to: string }> = {}
    picked.forEach((id, i) => {
      next[id] = s[i] ?? { from: 'A', to: 'A' }
    })
    setRanges(next)
    setPreview(null)
  }

  async function run(apply: boolean) {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const res = await fetch('/api/assignments/distribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          pool,
          fromId: pool === 'from' ? fromId : undefined,
          assignees: picked,
          method,
          count,
          ranges: method === 'alphabet' ? picked.map((id) => ({ assigneeId: id, ...(ranges[id] ?? { from: 'A', to: 'A' }) })) : undefined,
          apply,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not plan the distribution')
      if (apply) {
        setPreview(null)
        setDone(`Assigned ${d.assigned} carrier(s)${d.leftover ? `, ${d.leftover} left unassigned` : ''}.`)
        await onApplied()
      } else {
        setPreview(d)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not plan the distribution')
    } finally {
      setBusy(false)
    }
  }

  const radio = (checked: boolean, onChange: () => void, label: React.ReactNode) => (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input type="radio" checked={checked} onChange={onChange} className="h-4 w-4 border-gray-300 text-dts-blue focus:ring-dts-blue" />
      {label}
    </label>
  )

  return (
    <Card>
      <CardHeader
        title="Hand out carriers"
        subtitle="Give each person a share of the carriers to look after."
      />
      <CardBody className="space-y-5">
        <div className="rounded-md border border-dts-blue/20 bg-dts-blue/5 px-4 py-3 text-sm text-gray-700">
          <p className="font-medium text-gray-900">How this works</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>Choose which carriers to hand out. The usual choice is the ones nobody owns yet.</li>
            <li>Tick the people who should get them.</li>
            <li>Pick how to split them up. &ldquo;Evenly&rdquo; gives everyone about the same number, in alphabetical blocks (for example A&ndash;G, H&ndash;Q, R&ndash;Z).</li>
          </ol>
          <p className="mt-1.5">
            Click <span className="font-medium">Preview</span> to see who would get what. Nothing changes until you click <span className="font-medium">Apply</span>.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">1 · Which carriers</div>
            <Select label="Scope" value={scope} onChange={(e) => { setScope(e.target.value as Scope); setPreview(null) }}>
              <option value="active">Active in Brokerware (not declined)</option>
              <option value="all">Every carrier (not declined)</option>
            </Select>
            <div className="space-y-1.5 pt-1">
              {radio(pool === 'unassigned', () => { setPool('unassigned'); setPreview(null) }, 'Only carriers nobody owns yet')}
              {radio(pool === 'everyone', () => { setPool('everyone'); setPreview(null) }, 'Everything in scope (re-deals current owners too)')}
              {radio(pool === 'from', () => { setPool('from'); setPreview(null) }, 'One person’s carriers')}
              {pool === 'from' && (
                <select
                  value={fromId}
                  onChange={(e) => { setFromId(e.target.value); setPreview(null) }}
                  className="ml-6 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
                >
                  <option value="">Whose carriers?</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {memberName(m)} ({m.assigned})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <p className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{poolRows.length}</span> carrier(s) in the pool
            </p>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">2 · Who gets them</div>
            <div className="space-y-1.5">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={picked.includes(m.id)}
                    onChange={() => togglePerson(m.id)}
                    className="h-4 w-4 rounded border-gray-300 text-dts-blue focus:ring-dts-blue"
                  />
                  <span>{memberName(m)}</span>
                  <span className="text-xs text-gray-400">{ROLE_LABEL[m.role] ?? m.role} · has {m.assigned}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500">Carriers are dealt in alphabetical order, in the order people are ticked.</p>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">3 · How to split</div>
            <div className="space-y-1.5">
              {radio(method === 'even', () => { setMethod('even'); setPreview(null) }, 'Evenly — equal alphabetical blocks')}
              {radio(
                method === 'count',
                () => { setMethod('count'); setPreview(null) },
                <span className="flex items-center gap-2">
                  A set number each
                  <input
                    type="number"
                    min={1}
                    value={count}
                    onChange={(e) => { setCount(Math.max(1, Number(e.target.value) || 1)); setPreview(null) }}
                    className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
                  />
                </span>
              )}
              {radio(method === 'alphabet', () => { setMethod('alphabet'); setPreview(null) }, 'By letter range')}
            </div>
            {method === 'alphabet' && (
              <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
                {picked.length === 0 ? (
                  <p className="text-xs text-gray-500">Tick people first.</p>
                ) : (
                  <>
                    {picked.map((id) => {
                      const r = ranges[id] ?? { from: 'A', to: 'A' }
                      const m = members.find((x) => x.id === id)
                      return (
                        <div key={id} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="w-28 truncate font-medium text-gray-800">{memberName(m)}</span>
                          <select
                            value={r.from}
                            onChange={(e) => { setRanges({ ...ranges, [id]: { ...r, from: e.target.value } }); setPreview(null) }}
                            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
                          >
                            {LETTERS.map((l) => (
                              <option key={l} value={l}>{l}</option>
                            ))}
                          </select>
                          <span className="text-gray-400">to</span>
                          <select
                            value={r.to}
                            onChange={(e) => { setRanges({ ...ranges, [id]: { ...r, to: e.target.value } }); setPreview(null) }}
                            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
                          >
                            {LETTERS.map((l) => (
                              <option key={l} value={l}>{l}</option>
                            ))}
                          </select>
                          <span className="text-xs text-gray-500">{rangeCount(r.from, r.to)} carrier(s)</span>
                        </div>
                      )
                    })}
                    <Button size="sm" variant="outline" onClick={suggest}>
                      Suggest balanced ranges
                    </Button>
                    <p className="text-xs text-gray-500">“#” covers names that start with a number. Overlapping ranges go to whoever is listed first.</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
          <Button variant="outline" onClick={() => run(false)} disabled={busy || picked.length === 0 || poolRows.length === 0}>
            {busy && !preview ? <Spinner size={14} /> : null} Preview
          </Button>
          {preview && (
            <Button variant="primary" onClick={() => run(true)} disabled={busy}>
              Apply — assign {preview.assigned} carrier(s)
            </Button>
          )}
          {error && <span className="text-sm text-red-600">{error}</span>}
          {done && <span className="text-sm text-green-700">{done}</span>}
        </div>

        {preview && (
          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2">Person</th>
                  <th className="px-3 py-2 text-right">Gets</th>
                  <th className="px-3 py-2">Letters</th>
                  <th className="px-3 py-2">From</th>
                  <th className="px-3 py-2">To</th>
                </tr>
              </thead>
              <tbody>
                {preview.buckets.map((b) => (
                  <tr key={b.assigneeId} className="border-b border-gray-100">
                    <td className="px-4 py-2 font-medium text-gray-900">{b.name}</td>
                    <td className="px-3 py-2 text-right">{b.count}</td>
                    <td className="px-3 py-2 text-gray-700">{b.letters}</td>
                    <td className="px-3 py-2 text-gray-600">{b.first ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{b.last ?? '—'}</td>
                  </tr>
                ))}
                {preview.leftover > 0 && (
                  <tr className="bg-amber-50">
                    <td className="px-4 py-2 text-amber-800" colSpan={5}>
                      {preview.leftover} carrier(s) in the pool would stay unassigned.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
