'use client'

import { InsuranceRecord } from '@/lib/types'
import { Card, CardHeader, CardBody } from './ui/Card'
import { Badge, coverageStatusTone } from './ui/Badge'
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
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900">{c.title}</h4>
        <Badge tone={coverageStatusTone(c.status)}>{c.status ?? '—'}</Badge>
      </div>
      <div className="mt-1 text-xl font-bold text-gray-900">
        {formatCurrency(c.limit)}
      </div>
      {c.secondaryLimit && (
        <div className="text-xs text-gray-500">
          {c.secondaryLimit.label}: {formatCurrency(c.secondaryLimit.value)}
        </div>
      )}
      <dl className="mt-2 space-y-0.5 text-xs text-gray-600">
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
}: {
  insurance: InsuranceRecord | null
  // dot / onRefreshed kept off the panel now that the Refresh control lives in
  // the carrier header; the panel is display-only.
}) {
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
            ? `RMIS/SAFER pulled ${formatRelative(insurance.fetched_at)}`
            : 'No RMIS data on file'
        }
      />
      <CardBody>
        {/* Hard stops + flags are surfaced once, in the page-level AlertBanner
            above — not duplicated here. This card shows coverage details only. */}
        {!insurance ? (
          <p className="text-sm text-gray-500">
            No coverage data yet. Use “Refresh from RMIS/SAFER” at the top of the
            profile to pull the latest insurance and authority data for this
            carrier.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {coverages.map((c) => (
              <CoverageCard key={c.title} c={c} />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
