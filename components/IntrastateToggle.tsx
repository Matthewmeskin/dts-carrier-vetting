'use client'

import { useEffect, useState } from 'react'
import { Card, CardBody } from './ui/Card'
import { Spinner } from './ui/Spinner'
import { cn } from '@/lib/utils'
import type { Role } from '@/lib/roles'

// Manual "intrastate only" designation. Because turning this on suppresses a
// real do-not-use condition (no interstate operating authority), it is limited
// to Manager/Director, guarded by a confirm, and every change is logged to the
// carrier's Activity timeline by the status route.
export function IntrastateToggle({
  dot,
  value,
  onChanged,
  bare,
}: {
  dot: string
  value: boolean | null
  onChanged?: () => void | Promise<void>
  /** Render without the Card wrapper, to sit inside another panel (e.g. the
   *  carrier header tile). */
  bare?: boolean
}) {
  const [role, setRole] = useState<Role | null>(null)
  const [on, setOn] = useState(!!value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setOn(!!value), [value])
  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRole(d?.user?.role ?? null))
      .catch(() => {})
  }, [])

  const canEdit = role === 'manager' || role === 'director'

  async function toggle(next: boolean) {
    if (
      next &&
      !window.confirm(
        'Mark this carrier as INTRASTATE only?\n\n' +
          'This suppresses the "no interstate operating authority" hard stop. ' +
          'Only do this for carriers you have verified operate within a single ' +
          'state. This action is logged to the carrier’s activity.'
      )
    )
      return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/carriers/${dot}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_intrastate: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to update')
      setOn(next)
      await onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  const inner = (
    <>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-gray-900">Intrastate-only carrier</div>
            <div className="mt-0.5 max-w-2xl text-xs text-gray-500">
              Operates within a single state — interstate FMCSA operating authority
              is not required. When on, the “no active operating authority” hard
              stop is downgraded for this carrier.
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {saving && <Spinner size={14} />}
            <button
              type="button"
              role="switch"
              aria-checked={on}
              disabled={!canEdit || saving}
              onClick={() => toggle(!on)}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition',
                on ? 'bg-dts-blue' : 'bg-gray-300',
                (!canEdit || saving) && 'cursor-not-allowed opacity-50'
              )}
            >
              <span
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-white shadow transition',
                  on ? 'translate-x-5' : 'translate-x-0.5'
                )}
              />
            </button>
          </div>
        </div>
        {on && (
          <p className="mt-2 inline-block rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
            Intrastate designation active — interstate-authority hard stop suppressed.
          </p>
        )}
        {!canEdit && (
          <p className="mt-2 text-xs text-gray-400">
            Only a Manager or Director can change this.
          </p>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </>
  )

  if (bare) {
    return <div className="border-t border-gray-100 pt-4">{inner}</div>
  }
  return (
    <Card>
      <CardBody>{inner}</CardBody>
    </Card>
  )
}
