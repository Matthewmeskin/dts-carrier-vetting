'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { Card, CardHeader, CardBody } from './ui/Card'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'
import type { MapVehicle } from './FleetMap'
import type { EldFleetAnalysis, EldFlag } from '@/lib/eldAnalysis'

// Leaflet touches `window` on import, so load the map only on the client.
const FleetMap = dynamic(() => import('./FleetMap').then((m) => m.FleetMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-80 items-center justify-center rounded-lg border border-gray-200 text-sm text-gray-400">
      Loading map…
    </div>
  ),
})

// Local mirrors of the eldClient shapes (kept here so this client component
// doesn't import server-only code).
interface EldMeasurement {
  value: number | null
  unit: string | null
}
interface EldVehicle {
  name: string | null
  oem: string | null
  model: string | null
  modelYear: string | null
  vin: string | null
  licensePlateState: string | null
  licensePlateNumber: string | null
}
interface EldLocation {
  latitude: number | null
  longitude: number | null
  address: string | null
  dateTime: string | null
  speed: EldMeasurement | null
  odometer: EldMeasurement | null
  vehicle: EldVehicle | null
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-bold text-gray-900">{value}</div>
      {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
    </div>
  )
}

function flagTone(level: EldFlag['level']): string {
  switch (level) {
    case 'red':
      return 'border-red-200 bg-red-50 text-red-700'
    case 'amber':
      return 'border-amber-200 bg-amber-50 text-amber-700'
    default:
      return 'border-gray-200 bg-gray-50 text-gray-600'
  }
}

function flagIcon(level: EldFlag['level']): string {
  return level === 'red' ? '⛔' : level === 'amber' ? '⚠️' : 'ℹ️'
}

function vehicleName(v: EldVehicle | null): string {
  if (!v) return 'Vehicle'
  const parts = [v.modelYear, v.oem, v.model].filter(Boolean).join(' ')
  return v.name || parts || 'Vehicle'
}

function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`
}

function LocationTable({
  rows,
  footer,
}: {
  rows: EldLocation[]
  footer?: React.ReactNode
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="px-3 py-2">Vehicle</th>
            <th className="px-3 py-2">VIN / Plate</th>
            <th className="px-3 py-2">Location</th>
            <th className="px-3 py-2">Speed</th>
            <th className="px-3 py-2">Last Report</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v, i) => {
            const hasCoords = v.latitude != null && v.longitude != null
            return (
              <tr
                key={i}
                className="border-b border-gray-100 last:border-0 align-top"
              >
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-900">
                    {vehicleName(v.vehicle)}
                  </div>
                  {v.odometer?.value != null && (
                    <div className="text-xs text-gray-400">
                      {Math.round(v.odometer.value).toLocaleString()}{' '}
                      {v.odometer.unit || 'mi'}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-600">
                  <div className="font-mono text-xs">
                    {v.vehicle?.vin || '—'}
                  </div>
                  {v.vehicle?.licensePlateNumber && (
                    <div className="text-xs text-gray-400">
                      {[
                        v.vehicle.licensePlateState,
                        v.vehicle.licensePlateNumber,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  {hasCoords ? (
                    <a
                      href={mapsUrl(v.latitude!, v.longitude!)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-dts-blue hover:underline"
                    >
                      {v.address ||
                        `${v.latitude!.toFixed(4)}, ${v.longitude!.toFixed(4)}`}{' '}
                      ↗
                    </a>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-600">
                  {v.speed?.value != null ? (
                    <Badge tone={v.speed.value > 0 ? 'green' : 'gray'}>
                      {Math.round(v.speed.value)} {v.speed.unit || 'mph'}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">
                  {v.dateTime ? (
                    <>
                      <div>{formatRelative(v.dateTime)}</div>
                      <div className="text-gray-400">
                        {formatDateTime(v.dateTime)}
                      </div>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {footer}
    </div>
  )
}

export function EldPanel({
  dot,
  eldEnrolled,
}: {
  dot: string
  eldEnrolled?: boolean | null
}) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [vehicles, setVehicles] = useState<EldLocation[]>([])
  const [analysis, setAnalysis] = useState<EldFleetAnalysis | null>(null)
  const [autoRevet, setAutoRevet] = useState(false)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)

  // Single-VIN lookup
  const [vin, setVin] = useState('')
  const [vinLoading, setVinLoading] = useState(false)
  const [vinError, setVinError] = useState<string | null>(null)
  const [vinMessage, setVinMessage] = useState<string | null>(null)
  const [vinResult, setVinResult] = useState<EldLocation | null>(null)
  const [vinSearched, setVinSearched] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/carriers/${dot}/eld?check=1`)
      .then((r) => r.json())
      .then((d) => alive && setConfigured(Boolean(d.configured)))
      .catch(() => alive && setConfigured(false))
    return () => {
      alive = false
    }
  }, [dot])

  async function load() {
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/carriers/${dot}/eld`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `ELD lookup failed (${res.status})`)
      setVehicles(Array.isArray(data.vehicles) ? data.vehicles : [])
      setAnalysis(data.analysis ?? null)
      setAutoRevet(Boolean(data.autoRevet))
      // The API returns Success:false with a Message when the carrier isn't
      // ELD-enrolled or isn't attached to our RMIS client.
      if (!data.success && data.message) setMessage(data.message)
      setLoaded(true)
      setFetchedAt(new Date().toISOString())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ELD lookup failed')
    } finally {
      setLoading(false)
    }
  }

  async function lookupVin() {
    const q = vin.trim()
    if (!q) return
    setVinLoading(true)
    setVinError(null)
    setVinMessage(null)
    setVinResult(null)
    try {
      const res = await fetch(
        `/api/carriers/${dot}/eld?vin=${encodeURIComponent(q)}`,
        { cache: 'no-store' }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `VIN lookup failed (${res.status})`)
      setVinResult(data.location ?? null)
      if (!data.location && data.message) setVinMessage(data.message)
      else if (!data.location) setVinMessage('No location returned for that VIN.')
      setVinSearched(true)
    } catch (e) {
      setVinError(e instanceof Error ? e.message : 'VIN lookup failed')
    } finally {
      setVinLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            Fleet Location (ELD)
            {eldEnrolled === true ? (
              <Badge tone="green">ELD Connected</Badge>
            ) : eldEnrolled === false ? (
              <Badge tone="gray">Not ELD-enrolled</Badge>
            ) : null}
          </span>
        }
        subtitle={
          fetchedAt
            ? `Live from RMIS · pulled ${formatRelative(fetchedAt)}`
            : 'Real-time truck locations via RMIS ELD'
        }
        action={
          configured ? (
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              {loading ? <Spinner size={14} /> : null}
              {loading
                ? 'Loading…'
                : loaded
                  ? 'Refresh locations'
                  : 'Load live locations'}
            </Button>
          ) : undefined
        }
      />
      <CardBody>
        {configured === false && (
          <p className="text-sm text-gray-500">
            ELD lookups are not configured. Set{' '}
            <code className="rounded bg-gray-100 px-1">RMIS_CLIENT_ID</code> and{' '}
            <code className="rounded bg-gray-100 px-1">RMIS_CLIENT_PASSWORD</code>{' '}
            to enable.
          </p>
        )}

        {error && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {message && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {message}
          </div>
        )}

        {analysis && (
          <div className="mb-4 rounded-lg border border-gray-200 p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-semibold text-gray-900">
                Fleet Integrity
              </h4>
              <span className="text-xs text-gray-400">signal, not proof</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Trucks reporting"
                value={
                  analysis.powerUnits != null
                    ? `${analysis.trucksReporting} / ${analysis.powerUnits}`
                    : String(analysis.trucksReporting)
                }
                sub={analysis.powerUnits != null ? 'vs power units' : undefined}
              />
              <Stat label="Moving now" value={String(analysis.movingNow)} />
              <Stat
                label="Freshest report"
                value={
                  analysis.freshestReportAt
                    ? formatRelative(analysis.freshestReportAt)
                    : '—'
                }
              />
              <Stat
                label={`Stale (>24h)`}
                value={String(analysis.staleCount)}
              />
            </div>
            {autoRevet && (
              <div className="mt-3 rounded-md border border-dts-maroon/30 bg-[#fbe7ee] px-2.5 py-2 text-xs font-medium text-dts-maroon">
                ELD fraud signal recorded — carrier is in “Pending Review” for
                re-vet, and the reason is logged to its change history. Reload to
                see the updated status.
              </div>
            )}
            {analysis.flags.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {analysis.flags.map((f, i) => (
                  <li
                    key={i}
                    className={cn(
                      'flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs',
                      flagTone(f.level)
                    )}
                  >
                    <span className="leading-none">{flagIcon(f.level)}</span>
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              analysis.trucksReporting > 0 && (
                <p className="mt-2 text-xs text-green-700">
                  No fleet-integrity concerns from this snapshot.
                </p>
              )
            )}
          </div>
        )}

        {configured && !loaded && !loading && !error && (
          <p className="text-sm text-gray-500">
            {eldEnrolled === false ? (
              <>
                RMIS reports this carrier is{' '}
                <span className="font-medium">not ELD-enrolled</span>, so a live
                pull likely won’t return positions. You can still try below.
              </>
            ) : (
              <>
                Click “Load live locations” to pull this carrier’s current fleet
                positions from their ELD provider. The carrier must be
                ELD-enrolled and attached to our RMIS client.
              </>
            )}
          </p>
        )}

        {loaded && vehicles.length === 0 && !message && (
          <p className="text-sm text-gray-500">
            No vehicle locations were returned. The ELD provider may not be
            reporting positions right now.
          </p>
        )}

        {vehicles.length > 0 && (
          <>
            {(() => {
              const mapVehicles: MapVehicle[] = vehicles
                .filter((v) => v.latitude != null && v.longitude != null)
                .map((v) => ({
                  latitude: v.latitude!,
                  longitude: v.longitude!,
                  name: vehicleName(v.vehicle),
                  vin: v.vehicle?.vin ?? null,
                  speed: v.speed,
                  dateTime: v.dateTime,
                  address: v.address,
                }))
              if (mapVehicles.length === 0) return null
              return (
                <div className="mb-4">
                  <FleetMap vehicles={mapVehicles} />
                </div>
              )
            })()}
            <LocationTable
              rows={vehicles}
              footer={
                <p className="mt-2 text-xs text-gray-400">
                  {vehicles.length} vehicle{vehicles.length === 1 ? '' : 's'}{' '}
                  reporting. Positions come directly from the carrier’s ELD
                  provider and can lag or omit fields depending on the provider.
                </p>
              }
            />
          </>
        )}

        {/* Single-VIN lookup */}
        {configured && (
          <div className="mt-5 border-t border-gray-100 pt-4">
            <div className="mb-2 flex items-baseline gap-2">
              <h4 className="text-sm font-semibold text-gray-900">
                Look up a single vehicle
              </h4>
              <span className="text-xs text-gray-400">by VIN</span>
            </div>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                lookupVin()
              }}
            >
              <input
                type="text"
                value={vin}
                onChange={(e) => setVin(e.target.value.toUpperCase())}
                placeholder="Vehicle VIN"
                className="h-[38px] w-64 rounded-md border border-gray-300 px-3 font-mono text-sm uppercase focus:border-dts-blue focus:outline-none focus:ring-1 focus:ring-dts-blue"
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={vinLoading || !vin.trim()}
              >
                {vinLoading ? <Spinner size={14} /> : null}
                {vinLoading ? 'Looking up…' : 'Look up VIN'}
              </Button>
            </form>

            {vinError && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {vinError}
              </div>
            )}
            {vinMessage && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                {vinMessage}
              </div>
            )}
            {vinResult && (
              <div className="mt-3">
                <LocationTable rows={[vinResult]} />
              </div>
            )}
            {vinSearched && !vinResult && !vinMessage && !vinError && (
              <p className="mt-3 text-sm text-gray-500">
                No location found for that VIN.
              </p>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
