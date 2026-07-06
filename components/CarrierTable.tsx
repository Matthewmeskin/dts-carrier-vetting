'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CarrierSummary } from '@/lib/types'
import { Card } from './ui/Card'
import { Input, Select } from './ui/Input'
import {
  Badge,
  carrierStatusTone,
  coverageStatusTone,
} from './ui/Badge'
import { cn, formatDate, formatScore } from '@/lib/utils'
import {
  computeRevetStatus,
  isBrokerwareDisabled,
  type RevetState,
} from '@/lib/revet'
import type { BadgeTone } from './ui/Badge'

const ACTIVE_STATUSES = [
  'Approved',
  'Approved with Restrictions',
  'Exception Approved',
]

const REVET_TONE: Record<RevetState, BadgeTone> = {
  overdue: 'red',
  due_soon: 'amber',
  ok: 'green',
  unknown: 'gray',
}

// Friendly display labels for flagged score keys/labels coming from the DB
// (which may be raw column names like "driver_oos_score" or pre-labeled
// strings like "Driver OOS Score").
const SCORE_LABELS: Record<string, string> = {
  gap_score: 'GAP Score',
  crash_score: 'Crash Score',
  violation_score: 'Violation Score',
  csa_basics_score: 'CSA Basics Score',
  driver_oos_score: 'Driver OOS Score',
  critical_acute_violation_score: 'Critical/Acute Score',
  new_entrant_score: 'New Entrant Score',
  mcs_150_score: 'MCS-150 Score',
  judicial_hellholes_score: 'Judicial Hellholes Score',
  safety_rating_score: 'Safety Rating Score',
}

// Tokens that should stay fully uppercased in fallback formatting.
const ACRONYMS = new Set(['gap', 'oos', 'csa', 'mcs', 'dot', 'mc', 'us'])

function prettyScoreLabel(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, '_').replace(/_+/g, '_')
  if (SCORE_LABELS[key]) return SCORE_LABELS[key]
  // Fall back: de-underscore and title-case, keeping known acronyms uppercase.
  return raw
    .replace(/_/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) =>
      ACRONYMS.has(w.toLowerCase())
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join(' ')
}

type StatusFilter =
  | 'BrokerwareActive'
  | 'All'
  | 'Active'
  | 'Approved'
  | 'NeedsReview'
  | 'DueForRevet'
  | 'HardStop'
  | 'NotInRmis'
  | 'DoNotUse'
  | 'Disabled'

function isBrokerwareActive(status: string | null | undefined): boolean {
  return !!status && status.trim().toLowerCase() === 'active'
}

type SortKey = 'gap' | 'name' | 'reviewed'

function gapTone(gap: number | null): { tone: string; label: string } {
  if (gap === null || gap === undefined)
    return { tone: 'text-gray-400', label: '—' }
  if (gap >= 65) return { tone: 'text-green-700', label: formatScore(gap) }
  if (gap >= 60) return { tone: 'text-amber-600', label: formatScore(gap) }
  return { tone: 'text-red-600', label: formatScore(gap) }
}

// Shared column widths so the (fixed) header row and the virtualized body rows
// line up. Fixed widths sum to ~1000px; the carrier column flexes.
const COL = {
  carrier: 'min-w-[180px] flex-1 pr-3',
  dot: 'w-24 shrink-0 pr-2',
  gap: 'w-16 shrink-0 pr-2 text-right',
  flagged: 'w-52 shrink-0 pr-2',
  insurance: 'w-44 shrink-0 pr-2',
  rmis: 'w-28 shrink-0 pr-2',
  status: 'w-32 shrink-0 pr-2',
  reviewed: 'w-28 shrink-0 pr-2',
  revet: 'w-28 shrink-0',
}

export function CarrierTable({
  carriers,
  lastUpload,
}: {
  carriers: CarrierSummary[]
  lastUpload: string | null
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('BrokerwareActive')
  const [revettingOnly, setRevettingOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('gap')

  // Whether any carrier carries a Brokerware status yet. Until the Brokerware
  // sync has populated it, the "Active in Brokerware" filter falls back to
  // showing everything so the list isn't empty.
  const hasBrokerwareData = useMemo(
    () => carriers.some((c) => c.brokerware_status != null),
    [carriers]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = carriers.filter((c) => {
      if (q) {
        const hay = `${c.legal_name ?? ''} ${c.dba_name ?? ''} ${c.dot_number}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (revettingOnly && !c.requires_revetting) return false
      switch (status) {
        case 'BrokerwareActive':
          // Show only carriers Brokerware reports as Active. Before the sync has
          // run (no statuses at all), show everything rather than nothing.
          return !hasBrokerwareData || isBrokerwareActive(c.brokerware_status)
        case 'Active':
          return (
            !c.do_not_use &&
            !isBrokerwareDisabled(c.brokerware_status) &&
            c.carrier_status != null &&
            ACTIVE_STATUSES.includes(c.carrier_status)
          )
        case 'Disabled':
          return isBrokerwareDisabled(c.brokerware_status)
        case 'NotInRmis':
          // Active carriers RMIS has no record for (looked up, nothing found).
          return (
            (!hasBrokerwareData || isBrokerwareActive(c.brokerware_status)) &&
            c.rmis_status === 'not_in_rmis'
          )
        case 'Approved':
          return c.carrier_status === 'Approved'
        case 'NeedsReview':
          return (
            c.carrier_status === 'Pending Review' || !!c.requires_revetting
          )
        case 'DueForRevet': {
          if (isBrokerwareDisabled(c.brokerware_status)) return false
          const r = computeRevetStatus(
            c.last_reviewed,
            c.created_at,
            c.revet_interval_days
          )
          return r.state === 'overdue' || r.state === 'due_soon'
        }
        case 'HardStop':
          return (c.hard_stops?.length ?? 0) > 0
        case 'DoNotUse':
          return !!c.do_not_use || c.carrier_status === 'Do Not Use'
        default:
          return true
      }
    })

    rows = [...rows].sort((a, b) => {
      if (sort === 'name')
        return (a.legal_name ?? '').localeCompare(b.legal_name ?? '')
      if (sort === 'reviewed') {
        const av = a.last_reviewed ? Date.parse(a.last_reviewed) : 0
        const bv = b.last_reviewed ? Date.parse(b.last_reviewed) : 0
        return bv - av
      }
      // gap ascending, nulls last
      const ag = a.gap_score ?? Infinity
      const bg = b.gap_score ?? Infinity
      return ag - bg
    })

    return rows
  }, [carriers, search, status, revettingOnly, sort, hasBrokerwareData])

  // Virtualize the rows so only what's on screen is rendered — smooth scrolling
  // even with the full 700+ carrier roster.
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 68,
    overscan: 12,
  })

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3 border-b border-gray-100 px-5 py-4">
        <div className="w-64">
          <Input
            label="Search"
            placeholder="Carrier name or DOT number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-48">
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            <option value="BrokerwareActive">Active in Brokerware</option>
            <option value="All">All</option>
            <option value="Active">Active (vetting status)</option>
            <option value="Approved">Approved</option>
            <option value="NeedsReview">Needs Review</option>
            <option value="DueForRevet">Due for Re-vet</option>
            <option value="HardStop">Hard Stop</option>
            <option value="NotInRmis">Not in RMIS</option>
            <option value="DoNotUse">Do Not Use</option>
            <option value="Disabled">Inactive / Disabled (Brokerware)</option>
          </Select>
        </div>
        <div className="w-44">
          <Select
            label="Sort by"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="gap">GAP score (low → high)</option>
            <option value="name">Carrier name</option>
            <option value="reviewed">Last reviewed</option>
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={revettingOnly}
            onChange={(e) => setRevettingOnly(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-dts-blue focus:ring-dts-blue"
          />
          Requires revetting
        </label>
        <div className="ml-auto pb-2 text-right text-xs text-gray-500">
          <div>
            Last upload:{' '}
            <span className="font-medium text-gray-700">
              {lastUpload ? formatDate(lastUpload) : '—'}
            </span>
          </div>
          <div>{filtered.length} carrier(s) shown</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[1180px]">
          {/* Header row */}
          <div className="flex items-center border-b border-gray-100 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <div className={COL.carrier}>Carrier</div>
            <div className={COL.dot}>DOT</div>
            <div className={COL.gap}>GAP</div>
            <div className={COL.flagged}>Flagged Scores</div>
            <div className={COL.insurance}>Insurance</div>
            <div className={COL.rmis}>RMIS</div>
            <div className={COL.status}>Status</div>
            <div className={COL.reviewed}>Last Reviewed</div>
            <div className={COL.revet}>Re-vet</div>
          </div>

          {filtered.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">
              No carriers match the current filters.
            </div>
          ) : (
            <div ref={scrollRef} className="max-h-[70vh] overflow-y-auto">
              <div
                style={{
                  height: rowVirtualizer.getTotalSize(),
                  position: 'relative',
                  width: '100%',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((vi) => {
                  const c = filtered[vi.index]
                  const g = gapTone(c.gap_score)
                  const rv = computeRevetStatus(
                    c.last_reviewed,
                    c.created_at,
                    c.revet_interval_days
                  )
                  const disabled = isBrokerwareDisabled(c.brokerware_status)
                  return (
                    <div
                      key={c.id}
                      data-index={vi.index}
                      ref={rowVirtualizer.measureElement}
                      onClick={() => router.push(`/carriers/${c.dot_number}`)}
                      className="absolute left-0 top-0 flex w-full cursor-pointer items-start border-b border-gray-100 px-5 py-3 text-sm hover:bg-gray-50"
                      style={{ transform: `translateY(${vi.start}px)` }}
                    >
                      <div className={COL.carrier}>
                        <Link
                          href={`/carriers/${c.dot_number}`}
                          className="font-medium text-gray-900 hover:text-dts-blue hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {c.legal_name ?? `DOT ${c.dot_number}`}
                        </Link>
                        {c.dba_name && c.dba_name !== c.legal_name && (
                          <div className="text-xs text-gray-500">
                            dba {c.dba_name}
                          </div>
                        )}
                        <div className="text-xs text-gray-400">
                          {[c.city, c.state].filter(Boolean).join(', ')}
                        </div>
                      </div>
                      <div className={cn(COL.dot, 'whitespace-nowrap text-gray-600')}>
                        {c.dot_number}
                      </div>
                      <div className={cn(COL.gap, 'text-base font-bold', g.tone)}>
                        {g.label}
                      </div>
                      <div className={COL.flagged}>
                        {c.flagged_scores && c.flagged_scores.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {c.flagged_scores.map((f) => (
                              <Badge key={f} tone="amber">
                                {prettyScoreLabel(f)}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">None</span>
                        )}
                      </div>
                      <div className={COL.insurance}>
                        {(c.hard_stops?.length ?? 0) > 0 ? (
                          <Badge tone="red">
                            {c.hard_stops!.length} hard stop(s)
                          </Badge>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            <Badge tone={coverageStatusTone(c.auto_status)}>
                              Auto: {c.auto_status ?? '—'}
                            </Badge>
                            <Badge tone={coverageStatusTone(c.cargo_status)}>
                              Cargo: {c.cargo_status ?? '—'}
                            </Badge>
                          </div>
                        )}
                      </div>
                      <div className={COL.rmis}>
                        {c.rmis_status === 'certified' ? (
                          <Badge tone="green">Certified</Badge>
                        ) : c.rmis_status === 'not_certified' ? (
                          <Badge tone="gray">Not certified</Badge>
                        ) : c.rmis_status === 'not_in_rmis' ? (
                          <Badge tone="amber">Not in RMIS</Badge>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </div>
                      <div className={COL.status}>
                        {disabled ? (
                          <Badge tone="gray">
                            {c.brokerware_status || 'Disabled'} (Brokerware)
                          </Badge>
                        ) : (
                          <Badge tone={carrierStatusTone(c.carrier_status)}>
                            {c.carrier_status ?? '—'}
                          </Badge>
                        )}
                      </div>
                      <div
                        className={cn(
                          COL.reviewed,
                          'whitespace-nowrap text-xs text-gray-500'
                        )}
                      >
                        {c.last_reviewed ? formatDate(c.last_reviewed) : '—'}
                      </div>
                      <div className={cn(COL.revet, 'whitespace-nowrap')}>
                        {disabled ? (
                          <span className="text-xs text-gray-400">
                            Not required
                          </span>
                        ) : (
                          <>
                            <Badge tone={REVET_TONE[rv.state]}>{rv.label}</Badge>
                            <div className="mt-0.5 text-[10px] text-gray-400">
                              every {rv.intervalDays}d
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
