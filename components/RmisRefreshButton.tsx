'use client'

import { useState } from 'react'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'

// Pulls the latest RMIS record (and, for non-monitored carriers, the FMCSA/SAFER
// fallback) for this carrier, then asks the page to reload. Lives at the top of
// the carrier profile next to the carrier info. Shows its own inline error /
// document-archive status so it's self-contained wherever it's placed.
export function RmisRefreshButton({
  dot,
  onRefreshed,
  size = 'sm',
  className,
}: {
  dot: string
  onRefreshed?: () => void | Promise<void>
  size?: 'sm' | 'md'
  className?: string
}) {
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [docMsg, setDocMsg] = useState<string | null>(null)

  async function refresh() {
    setRefreshing(true)
    setError(null)
    setDocMsg(null)
    try {
      const res = await fetch(`/api/carriers/${dot}/insurance`, {
        cache: 'no-store',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Refresh failed')
      const d = data?.documents
      if (d) {
        if (d.archived > 0) {
          setDocMsg(
            `Archived ${d.archived} new document version(s); ${d.unchanged} unchanged.`
          )
        } else if (d.unchanged > 0) {
          setDocMsg(`Documents up to date (${d.unchanged} unchanged).`)
        }
      }
      await onRefreshed?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className={className}>
      <Button size={size} variant="outline" onClick={refresh} disabled={refreshing}>
        {refreshing ? <Spinner size={14} /> : null}
        {refreshing ? 'Refreshing…' : 'Refresh from RMIS/SAFER'}
      </Button>
      {error && (
        <p className="mt-1 max-w-[16rem] text-right text-xs text-red-600">{error}</p>
      )}
      {docMsg && (
        <p className="mt-1 max-w-[16rem] text-right text-xs text-green-700">
          {docMsg}
        </p>
      )}
    </div>
  )
}
