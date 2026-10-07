'use client'

import { useEffect, useState } from 'react'
import { memberName, type TeamMember } from '@/lib/assignments'

// The owner picker on a carrier page. Managers and directors can hand the
// carrier to anyone; staff can claim it for themselves or release their own.
export function AssignOwner({
  dot,
  assigneeId,
  assigneeName,
  onChanged,
}: {
  dot: string
  assigneeId: string | null
  assigneeName: string | null
  onChanged: () => void | Promise<void>
}) {
  const [team, setTeam] = useState<TeamMember[]>([])
  const [me, setMe] = useState<{ id: string; role: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/team', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return
        setTeam(d.members ?? [])
        setMe(d.me ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const canPickAnyone = me?.role === 'manager' || me?.role === 'director'

  async function change(next: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dots: [dot], assigneeId: next || null }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not update the owner')
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the owner')
    } finally {
      setBusy(false)
    }
  }

  // Staff see a simpler control: claim / release.
  if (me && !canPickAnyone) {
    const mine = assigneeId === me.id
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-500">Owner:</span>
        <span className="font-medium text-gray-800">{assigneeName ?? 'Unassigned'}</span>
        {mine ? (
          <button type="button" disabled={busy} onClick={() => change('')} className="text-xs text-gray-500 hover:underline">
            Release
          </button>
        ) : !assigneeId ? (
          <button type="button" disabled={busy} onClick={() => change(me.id)} className="text-xs text-dts-blue hover:underline">
            Assign to me
          </button>
        ) : null}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor="carrier-owner" className="text-gray-500">
        Owner:
      </label>
      <select
        id="carrier-owner"
        value={assigneeId ?? ''}
        disabled={busy || !me}
        onChange={(e) => change(e.target.value)}
        className="w-48 cursor-pointer rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
      >
        <option value="">Unassigned</option>
        {team.map((m) => (
          <option key={m.id} value={m.id}>
            {memberName(m)}
            {me && m.id === me.id ? ' (me)' : ''}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
