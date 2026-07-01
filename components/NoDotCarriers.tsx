'use client'

import { useEffect, useState } from 'react'

interface SkippedCarrier {
  id: string
  brokerware_carrier_id: number | null
  carrier_name: string | null
  mc: string | null
  scac: string | null
  city: string | null
  state: string | null
  phone: string | null
  email: string | null
}

export function NoDotCarriers() {
  const [rows, setRows] = useState<SkippedCarrier[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    fetch('/api/carriers/sync', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setRows(d.skipped ?? []))
      .catch(() => setRows([]))
  }, [])

  if (rows.length === 0) return null

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
          <span>⚠️</span>
          {rows.length} active Brokerware carrier(s) have no DOT — can’t be vetted
          until a DOT is added
        </div>
        <span className="text-xs text-amber-700">{open ? 'Hide' : 'Review'}</span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-amber-200">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-amber-700">
              <tr>
                <th className="px-4 py-2 font-semibold">Carrier</th>
                <th className="px-3 py-2 font-semibold">MC</th>
                <th className="px-3 py-2 font-semibold">SCAC</th>
                <th className="px-3 py-2 font-semibold">Location</th>
                <th className="px-3 py-2 font-semibold">Phone</th>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold">Brokerware ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-100">
              {rows.map((c) => (
                <tr key={c.id} className="text-gray-700">
                  <td className="px-4 py-2 font-medium text-gray-900">
                    {c.carrier_name || '—'}
                  </td>
                  <td className="px-3 py-2">{c.mc || '—'}</td>
                  <td className="px-3 py-2">{c.scac || '—'}</td>
                  <td className="px-3 py-2">
                    {[c.city, c.state].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2">{c.phone || '—'}</td>
                  <td className="px-3 py-2">{c.email || '—'}</td>
                  <td className="px-3 py-2 text-gray-400">
                    {c.brokerware_carrier_id ?? '—'}
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
