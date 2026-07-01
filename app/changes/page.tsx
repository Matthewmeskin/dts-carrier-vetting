'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { DeltaLogRecord } from '@/lib/types'
import { DELTA_SEVERITY_LABEL, type DeltaSeverity } from '@/lib/deltaRisk'
import { humanizeCode } from '@/lib/policyLabels'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge, carrierStatusTone, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { formatDateTime, formatRelative, cn } from '@/lib/utils'

interface Change extends DeltaLogRecord {
  severity: DeltaSeverity
  legal_name: string | null
  carrier_status: string | null
  do_not_use: boolean | null
}

interface Counts {
  total: number
  atRisk: number
  needsReview: number
  unreviewed: number
}

const SEVERITY_TONE: Record<DeltaSeverity, BadgeTone> = {
  at_risk: 'red',
  flag: 'amber',
  info: 'gray',
}

const SEVERITY_BORDER: Record<DeltaSeverity, string> = {
  at_risk: 'border-l-red-500',
  flag: 'border-l-amber-500',
  info: 'border-l-gray-200',
}

export default function ChangesPage() {
  const [changes, setChanges] = useState<Change[]>([])
  const [counts, setCounts] = useState<Counts | null>(null)
  const [loading, setLoading] = useState(true)
  const [riskOnly, setRiskOnly] = useState(true)
  const [unreviewedOnly, setUnreviewedOnly] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (riskOnly) params.set('riskOnly', 'true')
      if (unreviewedOnly) params.set('unreviewedOnly', 'true')
      const res = await fetch(`/api/changes?${params.toString()}`, {
        cache: 'no-store',
      })
      const data = await res.json()
      if (res.ok) {
        setChanges(data.changes ?? [])
        setCounts(data.counts ?? null)
      }
    } finally {
      setLoading(false)
    }
  }, [riskOnly, unreviewedOnly])

  useEffect(() => {
    load()
  }, [load])

  async function toggleReviewed(c: Change) {
    setSavingId(c.id)
    try {
      await fetch('/api/changes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, reviewed: !c.reviewed_at }),
      })
      await load()
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Carrier Changes</h1>
          <p className="text-sm text-gray-500">
            RMIS-detected changes across the network, flagged against the DTS
            vetting framework.
          </p>
        </div>
        {loading && <Spinner />}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="px-5 py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
            At Risk (Hard Stop)
          </div>
          <div className="mt-1 text-3xl font-bold text-red-600">
            {counts ? counts.atRisk : '—'}
          </div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Needs Review
          </div>
          <div className="mt-1 text-3xl font-bold text-amber-600">
            {counts ? counts.needsReview : '—'}
          </div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Unreviewed
          </div>
          <div className="mt-1 text-3xl font-bold text-dts-blue">
            {counts ? counts.unreviewed : '—'}
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={riskOnly}
            onChange={(e) => setRiskOnly(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-dts-blue focus:ring-dts-blue"
          />
          Only at-risk / flagged
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={unreviewedOnly}
            onChange={(e) => setUnreviewedOnly(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-dts-blue focus:ring-dts-blue"
          />
          Unreviewed only
        </label>
      </div>

      {changes.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-gray-500">
              No carrier changes match the current filters.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {changes.map((c) => {
            const hardStops = c.hard_stops_detected ?? []
            const flags = c.flags_detected ?? []
            const summary = c.change_summary ?? []
            return (
              <Card
                key={c.id}
                className={cn(
                  'border-l-4',
                  SEVERITY_BORDER[c.severity],
                  c.reviewed_at ? 'opacity-70' : ''
                )}
              >
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/carriers/${c.dot_number}`}
                          className="text-sm font-semibold text-gray-900 hover:text-dts-blue hover:underline"
                        >
                          {c.legal_name || `DOT ${c.dot_number}`}
                        </Link>
                        <span className="text-xs text-gray-400">
                          DOT {c.dot_number}
                        </span>
                        <Badge tone={SEVERITY_TONE[c.severity]}>
                          {DELTA_SEVERITY_LABEL[c.severity]}
                        </Badge>
                        {c.carrier_status && (
                          <Badge tone={carrierStatusTone(c.carrier_status)}>
                            {c.carrier_status}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {formatRelative(c.detected_at)} ·{' '}
                        {formatDateTime(c.detected_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.reviewed_at && (
                        <span className="text-xs text-gray-400">
                          Reviewed by {c.reviewed_by || '—'}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant={c.reviewed_at ? 'ghost' : 'outline'}
                        onClick={() => toggleReviewed(c)}
                        disabled={savingId === c.id}
                      >
                        {savingId === c.id ? (
                          <Spinner size={14} />
                        ) : c.reviewed_at ? (
                          'Reopen'
                        ) : (
                          'Mark reviewed'
                        )}
                      </Button>
                    </div>
                  </div>

                  {hardStops.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs font-semibold text-red-700">
                        Hard stops introduced ({hardStops.length})
                      </div>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-red-700">
                        {hardStops.map((h, i) => (
                          <li key={i}>{humanizeCode(h)}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {flags.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs font-semibold text-amber-700">
                        Flags requiring review ({flags.length})
                      </div>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-amber-700">
                        {flags.map((f, i) => (
                          <li key={i}>{humanizeCode(f)}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {summary.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs font-semibold text-gray-500">
                        What changed
                      </div>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-600">
                        {summary.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
