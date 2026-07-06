'use client'

import { useState } from 'react'
import { InsuranceRecord } from '@/lib/types'
import { Card, CardHeader, CardBody } from './ui/Card'
import { Badge, coverageStatusTone } from './ui/Badge'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'
import {
  cn,
  formatCurrency,
  formatDate,
  formatRelative,
  daysUntil,
} from '@/lib/utils'

interface Coverage {
  title: string
  status: string | null
  limit: number | null
  secondaryLimit?: { label: string; value: number | null }
  effective?: string | null
  expiration: string | null
  underwriter?: string | null
  rating?: string | null
  confidence?: string | null
  policyNumber?: string | null
}

// AM Best financial-strength rating → tone. A-grades are Excellent/Superior.
function ratingTone(r: string | null | undefined): string {
  const v = (r ?? '').trim().toUpperCase()
  if (!v || v === 'N/A' || v === 'NR') return 'text-gray-400'
  if (v.startsWith('A')) return 'text-green-700'
  if (v.startsWith('B')) return 'text-amber-600'
  return 'text-red-600'
}

function CoverageCard({ c }: { c: Coverage }) {
  const due = c.status === 'Valid' ? daysUntil(c.expiration) : null
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900">{c.title}</h4>
        <Badge tone={coverageStatusTone(c.status)}>{c.status ?? '—'}</Badge>
      </div>
      <div className="mt-2 text-2xl font-bold text-gray-900">
        {formatCurrency(c.limit)}
      </div>
      {c.secondaryLimit && (
        <div className="text-xs text-gray-500">
          {c.secondaryLimit.label}: {formatCurrency(c.secondaryLimit.value)}
        </div>
      )}
      <dl className="mt-3 space-y-1 text-xs text-gray-600">
        {c.effective !== undefined && (
          <div className="flex justify-between">
            <dt className="text-gray-400">Effective</dt>
            <dd>{formatDate(c.effective)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-gray-400">Expires</dt>
          <dd>
            {formatDate(c.expiration)}
            {due !== null && (
              <span
                className={cn(
                  'ml-1',
                  due < 30 ? 'text-red-600' : 'text-gray-400'
                )}
              >
                ({due}d)
              </span>
            )}
          </dd>
        </div>
        {c.underwriter !== undefined && (
          <div className="flex justify-between">
            <dt className="text-gray-400">Underwriter</dt>
            <dd className="text-right">{c.underwriter || '—'}</dd>
          </div>
        )}
        {c.rating !== undefined && (
          <div className="flex justify-between">
            <dt className="text-gray-400">Insurer Rating (AM Best)</dt>
            <dd className={cn('text-right font-medium', ratingTone(c.rating))}>
              {c.rating || '—'}
            </dd>
          </div>
        )}
        {c.confidence !== undefined && (
          <div className="flex justify-between">
            <dt className="text-gray-400">Confidence</dt>
            <dd>
              {c.confidence ? (
                <span
                  className={c.confidence === 'High' ? '' : 'text-amber-600'}
                >
                  {c.confidence}
                </span>
              ) : (
                '—'
              )}
            </dd>
          </div>
        )}
        {c.policyNumber !== undefined && (
          <div className="flex justify-between">
            <dt className="text-gray-400">Policy #</dt>
            <dd className="text-right">{c.policyNumber || '—'}</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

export function InsurancePanel({
  insurance,
  dot,
  onRefreshed,
}: {
  insurance: InsuranceRecord | null
  dot: string
  onRefreshed?: () => void | Promise<void>
}) {
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string[] | null>(null)
  const [showInfo, setShowInfo] = useState(false)
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
      if (data?.evaluation?.info) setInfo(data.evaluation.info)
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

  const hardStops = insurance?.hard_stops ?? []
  const flags = insurance?.rmis_flags ?? []

  const coverages: Coverage[] = insurance
    ? [
        {
          title: 'Auto Liability',
          status: insurance.auto_status,
          limit: insurance.auto_limit,
          effective: insurance.auto_effective_date,
          expiration: insurance.auto_expiration_date,
          underwriter: insurance.auto_underwriter,
          rating: insurance.auto_underwriter_rating,
          confidence: insurance.auto_confidence,
          policyNumber: insurance.auto_policy_number,
        },
        {
          title: 'Cargo',
          status: insurance.cargo_status,
          limit: insurance.cargo_limit,
          effective: insurance.cargo_effective_date,
          expiration: insurance.cargo_expiration_date,
          underwriter: insurance.cargo_underwriter,
          rating: insurance.cargo_underwriter_rating,
          confidence: insurance.cargo_confidence,
          policyNumber: insurance.cargo_policy_number,
        },
        {
          title: 'General Liability',
          status: insurance.general_status,
          limit: insurance.general_occurrence_limit,
          secondaryLimit: {
            label: 'Aggregate',
            value: insurance.general_aggregate_limit,
          },
          expiration: insurance.general_expiration_date,
        },
      ]
    : []

  return (
    <Card>
      <CardHeader
        title="Insurance Coverage"
        subtitle={
          insurance?.fetched_at
            ? `RMIS pulled ${formatRelative(insurance.fetched_at)}`
            : 'No RMIS data on file'
        }
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={refresh}
            disabled={refreshing}
          >
            {refreshing ? <Spinner size={14} /> : null}
            {refreshing ? 'Refreshing…' : 'Refresh from RMIS'}
          </Button>
        }
      />
      <CardBody>
        {error && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {docMsg && (
          <div className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            {docMsg}
          </div>
        )}

        {hardStops.length > 0 && (
          <div className="mb-3 rounded-md border-l-4 border-red-600 bg-red-50 px-3 py-2">
            <div className="text-sm font-semibold text-red-800">
              Hard stops ({hardStops.length})
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-red-700">
              {hardStops.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </div>
        )}

        {flags.length > 0 && (
          <div className="mb-3 rounded-md border-l-4 border-amber-500 bg-amber-50 px-3 py-2">
            <div className="text-sm font-semibold text-amber-800">
              Flags ({flags.length})
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-amber-700">
              {flags.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}

        {!insurance ? (
          <p className="text-sm text-gray-500">
            No coverage data yet. Click “Refresh RMIS” to pull the latest
            insurance and authority data for this carrier.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {coverages.map((c) => (
              <CoverageCard key={c.title} c={c} />
            ))}
          </div>
        )}

        {info && info.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <button
              onClick={() => setShowInfo((v) => !v)}
              className="text-xs font-medium text-dts-blue hover:underline"
            >
              {showInfo ? 'Hide' : 'Show'} additional info ({info.length})
            </button>
            {showInfo && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
                {info.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
