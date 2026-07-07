'use client'

import { useEffect, useState } from 'react'
import { Card, CardHeader, CardBody } from './ui/Card'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'
import { formatDateTime, formatRelative } from '@/lib/utils'

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

function vehicleName(v: EldVehicle | null): string {
  if (!v) return 'Vehicle'
  const parts = [v.modelYear, v.oem, v.model].filter(Boolean).join(' ')
  return v.name || parts || 'Vehicle'
}

function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`
}

export function EldPanel({ dot }: { dot: string }) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [vehicles, setVehicles] = useState<EldLocation[]>([])
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)

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

  return (
    <Card>
      <CardHeader
        title="Fleet Location (ELD)"
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

        {configured && !loaded && !loading && !error && (
          <p className="text-sm text-gray-500">
            Click “Load live locations” to pull this carrier’s current fleet
            positions from their ELD provider. The carrier must be ELD-enrolled
            and attached to our RMIS client.
          </p>
        )}

        {loaded && vehicles.length === 0 && !message && (
          <p className="text-sm text-gray-500">
            No vehicle locations were returned. The ELD provider may not be
            reporting positions right now.
          </p>
        )}

        {vehicles.length > 0 && (
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
                {vehicles.map((v, i) => {
                  const hasCoords =
                    v.latitude != null && v.longitude != null
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
            <p className="mt-2 text-xs text-gray-400">
              {vehicles.length} vehicle{vehicles.length === 1 ? '' : 's'} reporting.
              Positions come directly from the carrier’s ELD provider and can lag
              or omit fields depending on the provider.
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
