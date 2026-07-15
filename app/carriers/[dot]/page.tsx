'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CarrierDetail } from '@/lib/types'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge, carrierStatusTone, type BadgeTone } from '@/components/ui/Badge'
import {
  computeRevetStatus,
  isBrokerwareDisabled,
  type RevetState,
} from '@/lib/revet'
import { formatPhone } from '@/lib/utils'
import { Spinner } from '@/components/ui/Spinner'
import { AlertBanner } from '@/components/AlertBanner'
import { AuthorityPanel } from '@/components/AuthorityPanel'
import { SosPanel } from '@/components/SosPanel'
import { InsurancePanel } from '@/components/InsurancePanel'
import { EldPanel } from '@/components/EldPanel'
import { NoaPanel } from '@/components/NoaPanel'
import { ScorePanel } from '@/components/ScorePanel'
import { VettingChecklist } from '@/components/VettingChecklist'
import { CarrierDocuments } from '@/components/CarrierDocuments'
import { CarrierActivity } from '@/components/CarrierActivity'

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

  const { carrier, scores, insurance, vettingRecords, deltaLog, sos, factor, events } =
    detail
  const lastVetting = vettingRecords[0]?.completed_at ?? null
  const revetAnchor =
    lastVetting && carrier.revet_reset_at
      ? lastVetting >= carrier.revet_reset_at
        ? lastVetting
        : carrier.revet_reset_at
      : lastVetting || carrier.revet_reset_at
  const revet = computeRevetStatus(
    revetAnchor,
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
                {carrier.mc_number &&
                  (() => {
                    const mc = String(carrier.mc_number).replace(/\D/g, '')
                    return mc ? (
                      <a
                        href={
                          'https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY' +
                          '&query_type=queryCarrierSnapshot&query_param=MC_MX' +
                          `&query_string=${mc}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Look up on FMCSA SAFER"
                        className="text-dts-blue hover:underline"
                      >
                        MC {carrier.mc_number}
                      </a>
                    ) : (
                      <span>MC {carrier.mc_number}</span>
                    )
                  })()}
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
              {(() => {
                const join = (
                  street: string | null | undefined,
                  city: string | null | undefined,
                  state: string | null | undefined,
                  zip: string | null | undefined
                ) =>
                  [street, [city, state, zip].filter(Boolean).join(' ')]
                    .filter((p) => p && p.trim())
                    .join(', ')
                // Prefer the RMIS/DOT physical address; fall back to the
                // carrier's own address (Brokerware/TMS) when RMIS has none.
                const rmisAddr = join(
                  insurance?.rmis_carrier_street,
                  insurance?.rmis_carrier_city,
                  insurance?.rmis_carrier_state,
                  insurance?.rmis_carrier_zip
                )
                const carrierAddr = join(
                  carrier.street,
                  carrier.city,
                  carrier.state,
                  carrier.zip
                )
                const addr = rmisAddr || carrierAddr
                const addrSource = rmisAddr
                  ? 'Physical address (RMIS/DOT)'
                  : 'Physical address (Brokerware/TMS)'
                if (!addr && !carrier.phone && !carrier.email) return null
                return (
                  <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
                    {addr && <span title={addrSource}>{addr}</span>}
                    {carrier.phone && (
                      <a
                        href={`tel:${carrier.phone.replace(/[^0-9+]/g, '')}`}
                        className="text-dts-blue hover:underline"
                      >
                        {formatPhone(carrier.phone)}
                      </a>
                    )}
                    {carrier.email && (
                      <a
                        href={`mailto:${carrier.email}`}
                        className="break-all text-dts-blue hover:underline"
                      >
                        {carrier.email}
                      </a>
                    )}
                  </div>
                )
              })()}
            </div>
            <div className="text-right text-sm text-gray-500">
              {disabled ? (
                <span>Disabled — re-vetting not required</span>
              ) : (
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={REVET_TONE[revet.state]}>{revet.label}</Badge>
                  {revet.dueDate && (
                    <span className="text-xs">
                      due {revet.dueDate.toLocaleDateString()}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Authority & Identity, in the same tile as the carrier header */}
          <AuthorityPanel insurance={insurance} carrier={carrier} dot={dot} bare />

          {/* Business registration (Secretary of State) + factor */}
          <SosPanel dot={dot} sos={sos} factor={factor} onRefreshed={load} />
        </CardBody>
      </Card>

      <AlertBanner
        hardStops={insurance?.hard_stops}
        flags={insurance?.rmis_flags}
      />

      {/* Insurance */}
      <InsurancePanel insurance={insurance} dot={dot} onRefreshed={load} />

      {/* Notice of Assignment — factoring carriers only */}
      {insurance?.is_factoring && <NoaPanel dot={dot} />}

      {/* ELD — live fleet location */}
      <EldPanel dot={dot} eldEnrolled={insurance?.rmis_eld_enrolled ?? null} />

      {/* Safety Scores */}
      <ScorePanel scores={scores} />

      {/* Vetting Workspace */}
      <VettingChecklist
        dot={dot}
        carrierName={carrier.legal_name}
        safetyRating={carrier.safety_rating}
        insurance={insurance}
        score={scores[0]}
        sos={sos}
        vettingRecords={vettingRecords}
        onSaved={load}
        carrierStatus={carrier.carrier_status}
        onCarrierStatusChange={updateStatus}
        revetIntervalDays={carrier.revet_interval_days}
        onRevetIntervalChange={updateRevetInterval}
        revet={revet}
        revetDisabled={disabled}
        statusSaving={savingStatus}
      />

      {/* Documents */}
      <CarrierDocuments dot={dot} reloadKey={docReload} />

      {/* Unified activity timeline (RMIS changes + event log) */}
      <CarrierActivity deltaLog={deltaLog} events={events ?? []} />
    </div>
  )
}
