'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CarrierDetail } from '@/lib/types'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge, carrierStatusTone, type BadgeTone } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Input'
import {
  computeRevetStatus,
  isBrokerwareDisabled,
  REVET_INTERVAL_OPTIONS,
  type RevetState,
} from '@/lib/revet'
import { Spinner } from '@/components/ui/Spinner'
import { AlertBanner } from '@/components/AlertBanner'
import { AuthorityPanel } from '@/components/AuthorityPanel'
import { InsurancePanel } from '@/components/InsurancePanel'
import { ScorePanel } from '@/components/ScorePanel'
import { VettingChecklist } from '@/components/VettingChecklist'
import { CarrierDocuments } from '@/components/CarrierDocuments'
import { DeltaTimeline } from '@/components/DeltaTimeline'

const CARRIER_STATUSES = [
  'Pending Review',
  'Approved',
  'Approved with Restrictions',
  'Exception Approved',
  'Declined',
  'Suspended',
  'Do Not Use',
]

const REVET_TONE: Record<RevetState, BadgeTone> = {
  overdue: 'red',
  due_soon: 'amber',
  ok: 'green',
  unknown: 'gray',
}

export default function CarrierDetailPage({
  params,
}: {
  params: { dot: string }
}) {
  const dot = params.dot
  const [detail, setDetail] = useState<CarrierDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingStatus, setSavingStatus] = useState(false)
  const [docReload, setDocReload] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/carriers/${dot}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load carrier')
      setDetail(data)
      setDocReload((k) => k + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [dot])

  useEffect(() => {
    load()
  }, [load])

  async function updateStatus(status: string) {
    if (!detail) return
    setSavingStatus(true)
    try {
      const res = await fetch(`/api/carriers/${dot}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrier_status: status }),
      })
      if (res.ok) await load()
    } finally {
      setSavingStatus(false)
    }
  }

  async function updateRevetInterval(days: number) {
    if (!detail) return
    setSavingStatus(true)
    try {
      const res = await fetch(`/api/carriers/${dot}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revet_interval_days: days }),
      })
      if (res.ok) await load()
    } finally {
      setSavingStatus(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size={32} />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <Link href="/carriers" className="text-sm text-dts-blue hover:underline">
          ← Back to carriers
        </Link>
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || 'Carrier not found'}
        </div>
      </div>
    )
  }

  const { carrier, scores, insurance, vettingRecords, deltaLog } = detail
  const revet = computeRevetStatus(
    vettingRecords[0]?.completed_at ?? null,
    carrier.created_at,
    carrier.revet_interval_days
  )
  const disabled = isBrokerwareDisabled(carrier.brokerware_status)

  return (
    <div className="space-y-5">
      <Link href="/carriers" className="text-sm text-dts-blue hover:underline">
        ← Back to carriers
      </Link>

      {/* Panel 1 — Header */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-gray-900">
                  {carrier.legal_name || `DOT ${carrier.dot_number}`}
                </h1>
                <Badge tone={carrierStatusTone(carrier.carrier_status)}>
                  {carrier.carrier_status || '—'}
                </Badge>
                {disabled && (
                  <Badge tone="gray">
                    Disabled in Brokerware
                    {carrier.brokerware_status
                      ? ` (${carrier.brokerware_status})`
                      : ''}
                  </Badge>
                )}
                {carrier.do_not_use && <Badge tone="red">Do Not Use</Badge>}
              </div>
              {carrier.dba_name &&
                carrier.dba_name !== carrier.legal_name && (
                  <p className="text-sm text-gray-500">dba {carrier.dba_name}</p>
                )}
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
                <span>DOT {carrier.dot_number}</span>
                {carrier.mc_number && <span>MC {carrier.mc_number}</span>}
                <span>
                  {[carrier.city, carrier.state].filter(Boolean).join(', ') ||
                    '—'}
                </span>
                <span>{carrier.power_units ?? '—'} power units</span>
                <span>
                  Safety rating:{' '}
                  <span className="font-medium">
                    {carrier.safety_rating || 'Unrated'}
                  </span>
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="w-56">
                <Select
                  label="Carrier status"
                  value={carrier.carrier_status || 'Pending Review'}
                  disabled={savingStatus}
                  onChange={(e) => updateStatus(e.target.value)}
                >
                  {CARRIER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-56">
                <Select
                  label="Re-vetting cadence"
                  value={String(carrier.revet_interval_days ?? 120)}
                  disabled={savingStatus}
                  onChange={(e) => updateRevetInterval(Number(e.target.value))}
                >
                  {REVET_INTERVAL_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      Every {d} days
                    </option>
                  ))}
                </Select>
                <div className="mt-1.5 flex items-center gap-2">
                  {disabled ? (
                    <span className="text-xs text-gray-500">
                      Disabled — re-vetting not required
                    </span>
                  ) : (
                    <>
                      <Badge tone={REVET_TONE[revet.state]}>{revet.label}</Badge>
                      {revet.dueDate && (
                        <span className="text-xs text-gray-500">
                          due {revet.dueDate.toLocaleDateString()}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <AlertBanner
        hardStops={insurance?.hard_stops}
        flags={insurance?.rmis_flags}
      />

      {/* Panel 2 — Authority & Identity */}
      <AuthorityPanel insurance={insurance} />

      {/* Panel 3 — Insurance */}
      <InsurancePanel insurance={insurance} dot={dot} onRefreshed={load} />

      {/* Panel 4 — Safety Scores */}
      <ScorePanel scores={scores} />

      {/* Panel 5 — Vetting Workspace */}
      <VettingChecklist
        dot={dot}
        carrierName={carrier.legal_name}
        safetyRating={carrier.safety_rating}
        insurance={insurance}
        score={scores[0]}
        vettingRecords={vettingRecords}
        onSaved={load}
      />

      {/* Panel 6 — Documents */}
      <CarrierDocuments
        dot={dot}
        reloadKey={docReload}
        rmis={{
          insuredId: carrier.rmis_insured_id,
          certificate: insurance?.rmis_is_certified ?? null,
          w9: insurance?.w9_on_file ?? null,
          agreement: insurance?.broker_carrier_agreement_on_file ?? null,
        }}
      />

      {/* Panel 7 — Change History */}
      <DeltaTimeline entries={deltaLog} />
    </div>
  )
}
