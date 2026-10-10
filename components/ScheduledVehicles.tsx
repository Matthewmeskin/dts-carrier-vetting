'use client'

import { useState } from 'react'
import type { InsuranceRecord } from '@/lib/types'

type Vehicle = NonNullable<InsuranceRecord['rmis_scheduled_vehicles']>[number]

export const normVin = (v: string | null | undefined) =>
  String(v ?? '').replace(/\s+/g, '').toUpperCase()

// "Class 8: 33,001 lb and above (14,969 kg and above)" → "Class 8"
const gvwrClass = (g?: string) => (g ? g.split(':')[0].trim() : '')

// Vehicles listed on the carrier's auto policy, as RMIS pulls them from the
// insurer (<ScheduleOfVehicles>). Collapsed by default — the counts are what
// matter at a glance; the VIN list is there to check a specific truck.
export function ScheduledVehicles({
  vehicles,
}: {
  vehicles: InsuranceRecord['rmis_scheduled_vehicles']
}) {
  const [open, setOpen] = useState(false)
  const list: Vehicle[] = Array.isArray(vehicles) ? vehicles : []

  if (list.length === 0) {
    return (
      <p className="mt-4 text-xs text-gray-500">
        Scheduled vehicles: none on file. RMIS lists VINs only when the insurer
        schedules them on the auto policy (many policies are “any auto”).
      </p>
    )
  }

  const trucks = list.filter((v) => (v.type ?? '').toUpperCase() === 'TRUCK').length
  const trailers = list.filter((v) => (v.type ?? '').toUpperCase() === 'TRAILER').length
  const other = list.length - trucks - trailers

  return (
    <div className="mt-4 rounded-md border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="text-sm">
          <span className="font-semibold text-gray-900">Scheduled vehicles</span>
          <span className="text-gray-500">
            {' '}
            · {trucks} truck{trucks === 1 ? '' : 's'}, {trailers} trailer
            {trailers === 1 ? '' : 's'}
            {other > 0 ? `, ${other} other` : ''} on the auto policy
          </span>
        </span>
        <span className="shrink-0 text-xs text-dts-blue">
          {open ? 'Hide VINs' : 'Show VINs'}
        </span>
      </button>
      {open && (
        <div className="max-h-80 overflow-auto border-t border-gray-100">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">VIN</th>
                <th className="px-3 py-2">Vehicle</th>
                <th className="px-3 py-2">Type</th>
                <th className="hidden px-3 py-2 sm:table-cell">GVWR</th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.vin} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-1.5 font-mono text-xs text-gray-700">{v.vin}</td>
                  <td className="px-3 py-1.5 text-gray-900">
                    {[v.year, v.make, v.model].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-gray-600">
                    {v.type ? v.type.charAt(0) + v.type.slice(1).toLowerCase() : '—'}
                  </td>
                  <td className="hidden px-3 py-1.5 text-xs text-gray-500 sm:table-cell">
                    {gvwrClass(v.gvwr) || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
