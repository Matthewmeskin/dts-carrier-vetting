// Persists ELD fleet pulls + per-vehicle pings so we accumulate a position
// history (breadcrumbs) and can cross-reference equipment across carriers.
// Best-effort: storage failures must never break the live lookup.

import { supabaseAdmin } from './supabase'
import type { EldFleetResult } from './eldClient'

export async function persistFleetPull(params: {
  dot: string
  carrierId: string | null
  result: EldFleetResult
  source: 'manual' | 'poller'
}): Promise<void> {
  const { dot, carrierId, result, source } = params
  try {
    const { data: pull, error } = await (supabaseAdmin as any)
      .from('eld_fleet_pulls')
      .insert([
        {
          dot_number: dot,
          carrier_id: carrierId,
          success: result.success,
          message: result.message,
          vehicle_count: result.vehicles.length,
          source,
        },
      ])
      .select('id')
      .single()
    if (error || !pull) return

    const pullId = pull.id
    const rows = result.vehicles.map((v) => ({
      pull_id: pullId,
      dot_number: dot,
      carrier_id: carrierId,
      vin: v.vehicle?.vin ?? null,
      eld_device_id: v.vehicle?.eldDeviceId ?? null,
      vehicle_name: v.vehicle?.name ?? null,
      vehicle_oem: v.vehicle?.oem ?? null,
      vehicle_model: v.vehicle?.model ?? null,
      vehicle_year: v.vehicle?.modelYear ?? null,
      plate_state: v.vehicle?.licensePlateState ?? null,
      plate_number: v.vehicle?.licensePlateNumber ?? null,
      latitude: v.latitude,
      longitude: v.longitude,
      speed_mph: v.speed?.value ?? null,
      odometer_miles: v.odometer?.value ?? null,
      course: v.course,
      reported_at: v.dateTime,
      source,
    }))
    if (rows.length > 0) {
      await (supabaseAdmin as any).from('eld_vehicle_pings').insert(rows)
    }
  } catch {
    // swallow — persistence is best-effort
  }
}
