// RMIS ELD (Electronic Logging Device) location APIs.
//
// Two endpoints, both HTTP Basic auth (base64 of RMIS clientID:pwd) and both
// ALWAYS returning HTTP 200 — success is signalled by the `Success` field:
//   GET {BASE}/_c/std/api/CarrierEldFleetLocationAPI.aspx?dotNumber=...
//   GET {BASE}/_c/std/api/CarrierEldVehicleLocationAPI.aspx?dotNumber=...&vin=...
//
// Restrictions (surfaced via the Message field):
//   - The carrier must be ELD-enrolled.
//   - The carrier must be attached/registered with the RMIS client.

import { withRmisLock } from './rmisLock'

const BASE_URL = process.env.RMIS_BASE_URL || 'https://api.rmissecure.com'
const CLIENT_ID = process.env.RMIS_CLIENT_ID
const CLIENT_PASSWORD = process.env.RMIS_CLIENT_PASSWORD

const FLEET_URL = `${BASE_URL}/_c/std/api/CarrierEldFleetLocationAPI.aspx`
const VEHICLE_URL = `${BASE_URL}/_c/std/api/CarrierEldVehicleLocationAPI.aspx`

export interface EldVehicle {
  id: number | null
  name: string | null
  oem: string | null
  model: string | null
  modelYear: string | null
  vin: string | null
  licensePlateState: string | null
  licensePlateNumber: string | null
  eldDeviceId: string | null
  totalMiles: number | null
}

export interface EldMeasurement {
  value: number | null
  unit: string | null
}

export interface EldLocation {
  id: number | null
  vehicleId: number | null
  latitude: number | null
  longitude: number | null
  course: number | null
  address: string | null
  dateTime: string | null
  speed: EldMeasurement | null
  odometer: EldMeasurement | null
  vehicle: EldVehicle | null
}

export interface EldFleetResult {
  success: boolean
  message: string | null
  vehicles: EldLocation[]
}

export interface EldVehicleResult {
  success: boolean
  message: string | null
  eldEnrolled: boolean | null
  location: EldLocation | null
}

export function eldConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_PASSWORD)
}

function authHeader(): string {
  const token = Buffer.from(`${CLIENT_ID}:${CLIENT_PASSWORD}`).toString('base64')
  return `Basic ${token}`
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function str(v: any): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function measurement(m: any): EldMeasurement | null {
  if (!m || typeof m !== 'object') return null
  return { value: num(m.value ?? m.Value), unit: str(m.unit ?? m.Unit) }
}

function vehicle(v: any): EldVehicle | null {
  if (!v || typeof v !== 'object') return null
  return {
    id: num(v.id ?? v.Id),
    name: str(v.name ?? v.Name),
    oem: str(v.oem ?? v.Oem),
    model: str(v.model ?? v.Model),
    modelYear: str(v.modelYear ?? v.ModelYear),
    vin: str(v.vin ?? v.Vin),
    licensePlateState: str(v.licensePlateState ?? v.LicensePlateState),
    licensePlateNumber: str(v.licensePlateNumber ?? v.LicensePlateNumber),
    eldDeviceId: str(v.eldDeviceId ?? v.EldDeviceId),
    totalMiles: num(v.totalMiles ?? v.TotalMiles),
  }
}

function location(d: any): EldLocation {
  return {
    id: num(d.id ?? d.Id),
    vehicleId: num(d.vehicleId ?? d.VehicleId),
    latitude: num(d.latitude ?? d.Latitude),
    longitude: num(d.longitude ?? d.Longitude),
    course: num(d.course ?? d.Course),
    address: str(d.address ?? d.Address),
    dateTime: str(d.dateTime ?? d.DateTime),
    speed: measurement(d.speed ?? d.Speed),
    odometer: measurement(d.odometer ?? d.Odometer),
    vehicle: vehicle(d.vehicle ?? d.Vehicle),
  }
}

async function getJson(url: string, label: string): Promise<any> {
  if (!eldConfigured()) {
    throw new Error('RMIS credentials are not configured (RMIS_CLIENT_ID / RMIS_CLIENT_PASSWORD)')
  }
  return withRmisLock(
    async () => {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: authHeader() },
        cache: 'no-store',
      })
      const text = await res.text()
      try {
        return JSON.parse(text)
      } catch {
        // The API is documented to always return HTTP 200 JSON; a non-JSON body
        // means a transport/auth failure at the edge.
        throw new Error(`ELD API returned a non-JSON response (status ${res.status}).`)
      }
    },
    { label }
  )
}

/** All ELD vehicle locations for a carrier's fleet, by DOT number. */
export async function fetchFleetLocations(dot: string): Promise<EldFleetResult> {
  const url = `${FLEET_URL}?dotNumber=${encodeURIComponent(dot)}`
  const json = await getJson(url, 'eld-fleet')
  const data = json?.Data
  const vehicles = Array.isArray(data) ? data.map(location) : []
  return {
    success: Boolean(json?.Success),
    message: str(json?.Message),
    vehicles,
  }
}

/** A single ELD vehicle location for a carrier, by DOT number + VIN. */
export async function fetchVehicleLocation(
  dot: string,
  vin: string
): Promise<EldVehicleResult> {
  const url = `${VEHICLE_URL}?dotNumber=${encodeURIComponent(dot)}&vin=${encodeURIComponent(vin)}`
  const json = await getJson(url, 'eld-vehicle')
  const data = json?.Data
  return {
    success: Boolean(json?.Success),
    message: str(json?.Message ?? json?.message),
    eldEnrolled:
      typeof json?.eldEnrolled === 'boolean' ? json.eldEnrolled : null,
    location: data && typeof data === 'object' ? location(data) : null,
  }
}
