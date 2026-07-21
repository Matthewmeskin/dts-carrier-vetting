'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CarrierDetail } from '@/lib/types'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge, carrierStatusTone, type BadgeTone } from '@/components/ui/Badge'
import {
  computeRevetStatus,
  computeHaulActivity,
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
  const [statusError, setStatusError] = useState<string | null>(null)
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
    setStatusError(null)
    try {
      const res = await fetch(`/api/carriers/${dot}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrier_status: status }),
      })
      if (res.ok) await load()
      else {
        const d = await res.json().catch(() => ({}))
        setStatusError(d.error || 'Could not update status.')
      }
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

  const { carrier, scores, insurance, vettingRecords, deltaLog, sos, factor, events, documentTypes } =
    detail

  // RMIS flags are computed from RMIS data only, so the "no broker-carrier
  // agreement / no W-9" flags keep firing even after a copy is uploaded to the
  // portal. Suppress those specific flags when the portal has the document —
  // mirroring the vetting checklist, which already accepts a portal BCA / tariff
  // / W-9. (Other flags are unaffected.)
  const docSet = new Set((documentTypes ?? []).map((t: string) => (t || '').toLowerCase()))
  const hasAgreement = docSet.has('broker_carrier_agreement') || docSet.has('tariff')
  const hasW9 = docSet.has('w9')
  const keepFlag = (f: string): boolean => {
    const low = f.toLowerCase()
    if (hasAgreement && low.includes('broker-carrier agreement')) return false
    if (hasW9 && low.includes('w-9')) return false
    // Crash counts are informational only — severity is already captured by the
    // Bluewire safety scores, so never surface a crash flag/hard stop here.
    if (low.includes('crash')) return false
    return true
  }
  const displayFlags = (insurance?.rmis_flags ?? []).filter(keepFlag)
  const displayHardStops = (insurance?.hard_stops ?? []).filter(keepFlag)
  const displayInsurance = insurance
    ? { ...insurance, rmis_flags: displayFlags, hard_stops: displayHardStops }
    : insurance

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
                // Prefer the carrier's real contact from RMIS over the
                // Brokerware/TMS value (which is often a placeholder like
                // na@na.com); fall back to TMS when RMIS has none.
                const rmisEmail = insurance?.rmis_email || null
                const rmisPhone = insurance?.rmis_phone || null
                const email = rmisEmail || carrier.email
                const phone = rmisPhone || carrier.phone
                const contactName = insurance?.rmis_contact_name || null
                const contactTitle = insurance?.rmis_contact_title || null
                const emailTitle = rmisEmail
                  ? `Carrier contact (RMIS)${
                      contactName
                        ? ` — ${contactName}${contactTitle ? `, ${contactTitle}` : ''}`
                        : ''
                    }`
                  : 'Contact email (Brokerware/TMS)'
                if (!addr && !phone && !email) return null
                return (
                  <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
                    {addr && <span title={addrSource}>{addr}</span>}
                    {phone && (
                      <a
                        href={`tel:${phone.replace(/[^0-9+]/g, '')}`}
                        className="text-dts-blue hover:underline"
                        title={rmisPhone ? 'Carrier phone (RMIS)' : 'Phone (Brokerware/TMS)'}
                      >
                        {formatPhone(phone)}
                      </a>
                    )}
                    {email && (
                      <a
                        href={`mailto:${email}`}
                        className="break-all text-dts-blue hover:underline"
                        title={emailTitle}
                      >
                        {email}
                      </a>
                    )}
                  </div>
                )
              })()}
            </div>
            <div className="text-right text-sm text-gray-500">
              <div className="flex flex-col items-end gap-1">
                {disabled ? (
                  <span>Disabled — re-vetting not required</span>
                ) : (
                  <>
                    <Badge tone={REVET_TONE[revet.state]}>{revet.label}</Badge>
                    {revet.dueDate && (
                      <span className="text-xs">
                        due {revet.dueDate.toLocaleDateString()}
                      </span>
                    )}
                  </>
                )}
                {(() => {
                  const haul = computeHaulActivity(carrier.last_hauled_at)
                  if (!haul.lastHauledAt) {
                    return (
                      <Badge tone="gray">No DTS haul on record</Badge>
                    )
                  }
                  const tone: BadgeTone = haul.dormant
                    ? 'amber'
                    : (haul.daysSinceHauled ?? 0) < 0
                      ? 'blue'
                      : 'green'
                  return (
                    <span title={`Last hauled ${new Date(haul.lastHauledAt).toLocaleDateString()}`}>
                      <Badge tone={tone}>{haul.label}</Badge>
                    </span>
                  )
                })()}
              </div>
            </div>
          </div>

          {/* Authority & Identity, in the same tile as the carrier header */}
          <AuthorityPanel insurance={insurance} carrier={carrier} dot={dot} bare />

          {/* Business registration (Secretary of State) + factor */}
          <SosPanel dot={dot} sos={sos} factor={factor} onRefreshed={load} />
        </CardBody>
      </Card>

      <AlertBanner hardStops={displayHardStops} flags={displayFlags} />

      {/* Insurance */}
      <InsurancePanel insurance={displayInsurance} dot={dot} onRefreshed={load} />

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
        documentTypes={documentTypes}
        vettingRecords={vettingRecords}
        onSaved={load}
        carrierStatus={carrier.carrier_status}
        statusSetBy={(() => {
          const e = (events ?? []).find(
            (x: any) => x.event_type === 'status_change' && /status\s*→/i.test(x.summary || '')
          )
          return e ? { actor: e.actor ?? null, at: e.created_at ?? null } : null
        })()}
        onCarrierStatusChange={updateStatus}
        revetIntervalDays={carrier.revet_interval_days}
        onRevetIntervalChange={updateRevetInterval}
        revet={revet}
        revetDisabled={disabled}
        statusSaving={savingStatus}
        statusError={statusError}
      />

      {/* Documents */}
      <CarrierDocuments dot={dot} reloadKey={docReload} onChanged={load} />

      {/* Unified activity timeline (RMIS changes + event log) */}
      <CarrierActivity deltaLog={deltaLog} events={events ?? []} />
    </div>
  )
}
