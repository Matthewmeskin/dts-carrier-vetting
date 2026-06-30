'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CarrierSummary } from '@/lib/types'
import { Card } from './ui/Card'
import { Input, Select } from './ui/Input'
import {
  Badge,
  carrierStatusTone,
  coverageStatusTone,
} from './ui/Badge'
import { Table, THead, TBody, TR, TH, TD } from './ui/Table'
import { cn, formatDate, formatScore } from '@/lib/utils'

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
  | 'All'
  | 'Approved'
  | 'NeedsReview'
  | 'HardStop'
  | 'DoNotUse'

type SortKey = 'gap' | 'name' | 'reviewed'

function gapTone(gap: number | null): { tone: string; label: string } {
  if (gap === null || gap === undefined)
    return { tone: 'text-gray-400', label: '—' }
  if (gap >= 65) return { tone: 'text-green-700', label: formatScore(gap) }
  if (gap >= 60) return { tone: 'text-amber-600', label: formatScore(gap) }
  return { tone: 'text-red-600', label: formatScore(gap) }
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
  const [status, setStatus] = useState<StatusFilter>('All')
  const [revettingOnly, setRevettingOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('gap')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = carriers.filter((c) => {
      if (q) {
        const hay = `${c.legal_name ?? ''} ${c.dba_name ?? ''} ${c.dot_number}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (revettingOnly && !c.requires_revetting) return false
      switch (status) {
        case 'Approved':
          return c.carrier_status === 'Approved'
        case 'NeedsReview':
          return (
            c.carrier_status === 'Pending Review' || !!c.requires_revetting
          )
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
  }, [carriers, search, status, revettingOnly, sort])

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
            <option value="All">All</option>
            <option value="Approved">Approved</option>
            <option value="NeedsReview">Needs Review</option>
            <option value="HardStop">Hard Stop</option>
            <option value="DoNotUse">Do Not Use</option>
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

      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH>Carrier</TH>
            <TH>DOT</TH>
            <TH className="text-right">GAP</TH>
            <TH>Flagged Scores</TH>
            <TH>Insurance</TH>
            <TH>RMIS</TH>
            <TH>Status</TH>
            <TH>Last Reviewed</TH>
          </TR>
        </THead>
        <TBody>
          {filtered.length === 0 && (
            <TR className="hover:bg-transparent">
              <TD className="py-8 text-center text-gray-400" >
                <span className="block">No carriers match the current filters.</span>
              </TD>
            </TR>
          )}
          {filtered.map((c) => {
            const g = gapTone(c.gap_score)
            return (
              <TR
                key={c.id}
                className="cursor-pointer"
                onClick={() => router.push(`/carriers/${c.dot_number}`)}
              >
                <TD>
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
                </TD>
                <TD className="whitespace-nowrap text-gray-600">
                  {c.dot_number}
                </TD>
                <TD className={cn('text-right text-base font-bold', g.tone)}>
                  {g.label}
                </TD>
                <TD>
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
                </TD>
                <TD>
                  {(c.hard_stops?.length ?? 0) > 0 ? (
                    <Badge tone="red">{c.hard_stops!.length} hard stop(s)</Badge>
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
                </TD>
                <TD>
                  {c.rmis_is_certified === null ||
                  c.rmis_is_certified === undefined ? (
                    <span className="text-xs text-gray-400">—</span>
                  ) : c.rmis_is_certified ? (
                    <Badge tone="green">Certified</Badge>
                  ) : (
                    <Badge tone="gray">Not certified</Badge>
                  )}
                </TD>
                <TD>
                  <Badge tone={carrierStatusTone(c.carrier_status)}>
                    {c.carrier_status ?? '—'}
                  </Badge>
                </TD>
                <TD className="whitespace-nowrap text-xs text-gray-500">
                  {c.last_reviewed ? formatDate(c.last_reviewed) : '—'}
                </TD>
              </TR>
            )
          })}
        </TBody>
      </Table>
    </Card>
  )
}
