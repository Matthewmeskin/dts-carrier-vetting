'use client'

import { useCallback, useEffect, useState } from 'react'
import { CarrierSummary } from '@/lib/types'
import { SummaryCards, Metrics } from '@/components/SummaryCards'
import { CarrierTable } from '@/components/CarrierTable'
import { Spinner } from '@/components/ui/Spinner'

export default function CarriersPage() {
  const [carriers, setCarriers] = useState<CarrierSummary[]>([])
  const [lastUpload, setLastUpload] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [cRes, mRes] = await Promise.all([
        fetch('/api/carriers', { cache: 'no-store' }),
        fetch('/api/metrics', { cache: 'no-store' }),
      ])
      const cData = await cRes.json()
      if (!cRes.ok) throw new Error(cData.error || 'Failed to load carriers')
      setCarriers(cData.carriers ?? [])
      setLastUpload(cData.lastUpload ?? null)

      const mData = await mRes.json()
      if (mRes.ok) setMetrics(mData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Carrier Network</h1>
          <p className="text-sm text-gray-500">
            Compliance status across every carrier in the DTS network.
          </p>
        </div>
        {loading && <Spinner />}
      </div>

      <SummaryCards metrics={metrics} loading={loading} />

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <CarrierTable carriers={carriers} lastUpload={lastUpload} />
      )}
    </div>
  )
}
