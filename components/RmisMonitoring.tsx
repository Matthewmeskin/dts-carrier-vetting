'use client'

import { useEffect, useState } from 'react'
import { Card, CardBody } from './ui/Card'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'
import type { Role } from '@/lib/roles'

// Detach a carrier from RMIS monitoring. Surfaced prominently when the carrier
// is disabled in the TMS (we shouldn't keep paying RMIS to monitor a carrier we
// no longer use), and available on demand otherwise. Manager/Director only.
export function RmisMonitoring({
  dot,
  disabledInTms,
  brokerwareStatus,
  onChanged,
}: {
  dot: string
  disabledInTms?: boolean
  brokerwareStatus?: string | null
  onChanged?: () => void | Promise<void>
}) {
  const [role, setRole] = useState<Role | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRole(d?.user?.role ?? null))
      .catch(() => {})
  }, [])

  const canEdit = role === 'manager' || role === 'director'

  async function detach() {
    if (
      !window.confirm(
        'Detach this carrier from RMIS monitoring?\n\n' +
          'RMIS will stop tracking (and charging for) this carrier. Do this for ' +
          'carriers you no longer work with. This is logged to the carrier’s activity.'
      )
    )
      return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/carriers/${dot}/rmis-monitoring`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'Detach' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to detach')
      setDone(true)
      await onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to detach')
    } finally {
      setSaving(false)
    }
  }

  // Only worth showing when it's actionable: either the carrier is disabled in
  // the TMS (prompt to detach) or a Manager/Director wants to do it manually.
  if (!disabledInTms && !canEdit) return null

  return (
    <Card>
      <CardBody className="py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            <span className="font-medium text-gray-900">RMIS monitoring</span>
            {disabledInTms ? (
              <span className="ml-2 text-xs text-amber-700">
                Disabled in TMS{brokerwareStatus ? ` (${brokerwareStatus})` : ''} —
                detach to stop RMIS tracking &amp; billing.
              </span>
            ) : (
              <span className="ml-2 text-xs text-gray-500">
                Detach carriers you no longer work with (stops RMIS tracking &amp; billing).
              </span>
            )}
          </div>
          {done ? (
            <span className="text-xs font-medium text-green-700">Detached from RMIS</span>
          ) : (
            <Button
              size="sm"
              variant={disabledInTms ? 'primary' : 'secondary'}
              onClick={detach}
              disabled={!canEdit || saving}
              title={canEdit ? '' : 'Manager or Director only'}
            >
              {saving ? <Spinner size={14} className="text-white" /> : null}
              {saving ? 'Detaching…' : 'Detach from RMIS'}
            </Button>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </CardBody>
    </Card>
  )
}
