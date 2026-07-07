// Fleet-integrity signals derived from a single ELD fleet snapshot. These are
// heuristics meant to surface fraud/shell-carrier risk (e.g. a carrier claiming
// a large fleet with no trucks actually reporting), not proof on their own.

export interface AnalysisVehicle {
  latitude: number | null
  longitude: number | null
  speed: { value: number | null } | null
  dateTime: string | null // ELD report time (ISO)
}

export interface EldFlag {
  level: 'red' | 'amber' | 'info'
  text: string
}

export interface EldFleetAnalysis {
  trucksReporting: number
  withCoords: number
  movingNow: number
  powerUnits: number | null
  fleetRatio: number | null
  freshestReportAt: string | null
  stalestReportAt: string | null
  staleCount: number
  dormantCount: number
  domicileState: string | null
  nearestTruckMiles: number | null
  flags: EldFlag[]
}

const STALE_HOURS = 24
const GOING_DARK_DAYS = 30
const DARK_FLEET_DAYS = 90

// Approximate geographic centroids (lat, lng) per US state + DC. Precise enough
// for a "is any truck within ~hundreds of miles of home base" heuristic.
const STATE_CENTROIDS: Record<string, [number, number]> = {
  AL: [32.8, -86.8], AK: [64.2, -152.3], AZ: [34.3, -111.7], AR: [34.9, -92.4],
  CA: [37.2, -119.4], CO: [39.0, -105.5], CT: [41.6, -72.7], DE: [39.0, -75.5],
  DC: [38.9, -77.0], FL: [28.6, -82.4], GA: [32.6, -83.4], HI: [20.3, -156.4],
  ID: [44.4, -114.6], IL: [40.0, -89.2], IN: [39.9, -86.3], IA: [42.0, -93.5],
  KS: [38.5, -98.3], KY: [37.5, -85.3], LA: [31.0, -92.0], ME: [45.4, -69.2],
  MD: [39.0, -76.8], MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3],
  MS: [32.7, -89.7], MO: [38.4, -92.5], MT: [47.0, -109.6], NE: [41.5, -99.8],
  NV: [39.3, -116.6], NH: [43.7, -71.6], NJ: [40.1, -74.7], NM: [34.4, -106.1],
  NY: [42.9, -75.5], NC: [35.5, -79.4], ND: [47.4, -100.5], OH: [40.3, -82.8],
  OK: [35.6, -97.5], OR: [44.0, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.6],
  SC: [33.9, -80.9], SD: [44.4, -100.2], TN: [35.9, -86.4], TX: [31.5, -99.3],
  UT: [39.3, -111.7], VT: [44.1, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.5],
  WV: [38.6, -80.6], WI: [44.6, -89.9], WY: [43.0, -107.6],
}

function haversineMiles(
  a: [number, number],
  b: [number, number]
): number {
  const R = 3958.8
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function analyzeFleet(params: {
  vehicles: AnalysisVehicle[]
  powerUnits: number | null
  domicileState: string | null
}): EldFleetAnalysis {
  const { vehicles, powerUnits } = params
  const domicileState = (params.domicileState || '').trim().toUpperCase() || null

  const now = Date.now()
  const staleMs = STALE_HOURS * 3600 * 1000

  let withCoords = 0
  let movingNow = 0
  let staleCount = 0
  let dormantCount = 0
  let freshest: number | null = null
  let stalest: number | null = null
  let nearestMiles: number | null = null

  const centroid = domicileState ? STATE_CENTROIDS[domicileState] : undefined

  for (const v of vehicles) {
    const hasCoords = v.latitude != null && v.longitude != null
    if (hasCoords) withCoords++

    const speed = v.speed?.value ?? 0
    const moving = speed > 0
    if (moving) movingNow++

    const t = v.dateTime ? Date.parse(v.dateTime) : NaN
    const isStale = Number.isFinite(t) ? now - t > staleMs : true
    if (isStale) staleCount++
    if (isStale && !moving) dormantCount++
    if (Number.isFinite(t)) {
      freshest = freshest == null ? t : Math.max(freshest, t)
      stalest = stalest == null ? t : Math.min(stalest, t)
    }

    if (hasCoords && centroid) {
      const d = haversineMiles(centroid, [v.latitude!, v.longitude!])
      nearestMiles = nearestMiles == null ? d : Math.min(nearestMiles, d)
    }
  }

  const trucksReporting = vehicles.length
  const fleetRatio =
    powerUnits && powerUnits > 0 ? trucksReporting / powerUnits : null

  const flags: EldFlag[] = []

  // Fleet-size reality check.
  if (powerUnits && powerUnits >= 5 && trucksReporting === 0) {
    flags.push({
      level: 'red',
      text: `No trucks reporting via ELD despite ${powerUnits} power units on file — verify the fleet actually exists.`,
    })
  } else if (
    powerUnits &&
    powerUnits >= 4 &&
    trucksReporting > 0 &&
    fleetRatio !== null &&
    fleetRatio < 0.2
  ) {
    flags.push({
      level: 'amber',
      text: `Only ${trucksReporting} of ${powerUnits} power units are reporting via ELD.`,
    })
  }

  // Dormancy — tiered by how long the *whole fleet* has been dark. ELDs report
  // position over cellular near-continuously, so a fleet with no valid position
  // in months is effectively abandoned / nonexistent. Judged on the freshest
  // report across all trucks so ordinary per-truck attrition doesn't misfire.
  const freshestAgeDays =
    freshest != null ? (now - freshest) / (24 * 3600 * 1000) : null
  if (trucksReporting > 0 && freshestAgeDays != null) {
    if (freshestAgeDays > DARK_FLEET_DAYS) {
      flags.push({
        level: 'red',
        text: `No valid ELD position from any truck in ${Math.round(
          freshestAgeDays
        )} days (over ${DARK_FLEET_DAYS}) — likely an abandoned or nonexistent fleet.`,
      })
    } else if (freshestAgeDays > GOING_DARK_DAYS) {
      flags.push({
        level: 'amber',
        text: `No fresh ELD activity across the fleet in ${Math.round(
          freshestAgeDays
        )} days.`,
      })
    } else if (dormantCount > 0) {
      flags.push({
        level: 'amber',
        text: `${dormantCount} truck(s) parked and stale (stopped, no report in over ${STALE_HOURS}h).`,
      })
    }
  }

  // Domicile distance (soft signal).
  if (nearestTruckMilesIsFar(nearestMiles) && domicileState) {
    flags.push({
      level: 'amber',
      text: `No truck is within ~${Math.round(nearestMiles!).toLocaleString()} mi of the ${domicileState} domicile — unusual for a home-based fleet.`,
    })
  }

  return {
    trucksReporting,
    withCoords,
    movingNow,
    powerUnits: powerUnits ?? null,
    fleetRatio,
    freshestReportAt: freshest != null ? new Date(freshest).toISOString() : null,
    stalestReportAt: stalest != null ? new Date(stalest).toISOString() : null,
    staleCount,
    dormantCount,
    domicileState,
    nearestTruckMiles: nearestMiles != null ? Math.round(nearestMiles) : null,
    flags,
  }
}

function nearestTruckMilesIsFar(miles: number | null): boolean {
  return miles != null && miles > 750
}
