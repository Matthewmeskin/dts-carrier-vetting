'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual'
import { CarrierSummary } from '@/lib/types'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
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
import { ProblemFilter } from './ProblemFilter'
import { carrierProblems, problemFacets } from '@/lib/problems'
import { FacetFilter, type FacetOption } from './FacetFilter'
import {
  refineBusinessType,
  BIZ_KEY_SINGLE_MEMBER_LLC,
  BIZ_KEY_INDIVIDUAL,
  BIZ_KEY_INCORPORATED,
} from '@/lib/businessType'
import { INACTIVE_CARRIER_HOLD_NOTE } from '@/lib/statusNotes'

const UNKNOWN_BIZ = 'Unknown'

/** The carrier's business type key (W-9 company type), 'Unknown' when absent. */
function businessTypeKey(c: CarrierSummary): string {
  const v = (c.business_type ?? '').trim()
  if (!v) return UNKNOWN_BIZ
  // Split the combined Individual/Sole-Prop/single-member-LLC W-9 value by
  // LLC-in-name so the two can be filtered apart (see lib/businessType).
  const refined = refineBusinessType(v, c.legal_name)
  return refined.key || UNKNOWN_BIZ
}

/** Shorten the verbose FMCSA labels for display. */
function businessTypeLabel(key: string): string {
  if (key === BIZ_KEY_SINGLE_MEMBER_LLC) return 'Single-member LLC (inferred)'
  if (key === BIZ_KEY_INDIVIDUAL) return 'Individual / Sole Proprietor'
  if (key === BIZ_KEY_INCORPORATED) return 'Incorporated (per name)'
  return key
}

// Documents a carrier is missing (that we'd chase for upload). The API sets each
// on-file flag from RMIS OR a portal upload, so `false` means no evidence exists
// anywhere (incl. carriers with no RMIS record) — those count as missing.
const MISSING_DOC_LABELS: Record<string, string> = {
  w9: 'W-9',
  agreement: 'Broker-Carrier Agreement / Tariff',
  noa: 'NOA (factoring)',
}
function carrierMissingDocs(c: CarrierSummary): string[] {
  const missing: string[] = []
  if (c.w9_on_file === false) missing.push('w9')
  if (c.agreement_on_file === false) missing.push('agreement')
  if (c.is_factoring === true && !c.noa_on_file) missing.push('noa')
  return missing
}

/** MC number digits only (Brokerware/RMIS may carry prefixes or spacing, and
 *  the value can arrive as a number, so coerce to string before stripping). */
function mcDigits(mc: string | number | null | undefined): string {
  return String(mc ?? '').replace(/\D/g, '')
}

/** FMCSA SAFER carrier-snapshot lookup for an MC number. */
function saferMcUrl(mc: string): string {
  return (
    'https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot' +
    `&query_param=MC_MX&query_string=${mcDigits(mc)}`
  )
}

/** Quote a CSV cell when it contains a comma, quote, or newline. */
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Build a CSV of the currently-visible rows for the "Export to Excel" button.
// Excel opens .csv natively; the leading BOM keeps UTF-8 names intact.
function buildCarrierCsv(rows: CarrierSummary[]): string {
  const headers = [
    'Carrier', 'DBA', 'DOT', 'MC', 'City', 'State', 'GAP', 'Flagged Scores',
    'Hard Stops', 'Auto Status', 'Auto Expiration', 'Cargo Status',
    'Cargo Expiration', 'RMIS', 'ELD Enrolled', 'Brokerware Status',
    'Vetting Status', 'Last Reviewed', 'Re-vet',
  ]
  const lines = [headers.join(',')]
  for (const c of rows) {
    const rv = computeRevetStatus(c.last_reviewed, c.created_at, c.revet_interval_days)
    const disabled = isBrokerwareDisabled(c.brokerware_status)
    const rmis =
      c.rmis_status === 'certified' ? 'Certified'
      : c.rmis_status === 'not_certified' ? 'Not certified'
      : c.rmis_status === 'not_in_rmis' ? 'Not in RMIS' : ''
    lines.push([
      c.legal_name ?? '',
      c.dba_name && c.dba_name !== c.legal_name ? c.dba_name : '',
      c.dot_number,
      mcDigits(c.mc_number),
      c.city ?? '',
      c.state ?? '',
      c.gap_score ?? '',
      (c.flagged_scores ?? []).map(prettyScoreLabel).join('; '),
      (c.hard_stops ?? []).join('; '),
      c.auto_status ?? '',
      c.auto_expiration_date ?? '',
      c.cargo_status ?? '',
      c.cargo_expiration_date ?? '',
      rmis,
      c.eld_enrolled ? 'Yes' : '',
      disabled ? c.brokerware_status ?? 'Disabled' : c.brokerware_status ?? '',
      c.carrier_status ?? '',
      c.last_reviewed ? formatDate(c.last_reviewed) : '',
      disabled ? 'Not required' : rv.label,
    ].map(csvCell).join(','))
  }
  return lines.join('\n')
}

const ACTIVE_STATUSES = ['Approved', 'Exception Approved']

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
  | 'OnHold'
  | 'Disabled'

// Valid status values, used to validate a persisted view before applying it so
// a stale/corrupt saved value can never put the filter into a bad state.
const STATUS_VALUES = new Set<StatusFilter>([
  'BrokerwareActive', 'All', 'Active', 'Approved', 'NeedsReview',
  'DueForRevet', 'HardStop', 'NotInRmis', 'DoNotUse', 'OnHold', 'Disabled',
])

function isBrokerwareActive(status: string | null | undefined): boolean {
  return !!status && status.trim().toLowerCase() === 'active'
}

type SortKey =
  | 'carrier'
  | 'dot'
  | 'gap'
  | 'flagged'
  | 'insurance'
  | 'rmis'
  | 'status'
  | 'reviewed'
  | 'revet'
type SortDir = 'asc' | 'desc'

const RMIS_RANK: Record<string, number> = {
  certified: 0,
  not_certified: 1,
  not_in_rmis: 2,
  pending: 3,
}

interface SortColDef {
  getValue: (c: CarrierSummary) => number | string | null
  type: 'num' | 'str'
  defaultDir: SortDir
}

// How each sortable column extracts its comparison value + its natural first
// click direction. Null values always sort last regardless of direction.
const SORT_COLS: Record<SortKey, SortColDef> = {
  carrier: {
    getValue: (c) => (c.legal_name ?? '').toLowerCase(),
    type: 'str',
    defaultDir: 'asc',
  },
  dot: { getValue: (c) => Number(c.dot_number) || 0, type: 'num', defaultDir: 'asc' },
  gap: { getValue: (c) => c.gap_score ?? null, type: 'num', defaultDir: 'asc' },
  flagged: {
    getValue: (c) => c.flagged_scores?.length ?? 0,
    type: 'num',
    defaultDir: 'desc',
  },
  insurance: {
    getValue: (c) => c.hard_stops?.length ?? 0,
    type: 'num',
    defaultDir: 'desc',
  },
  rmis: {
    getValue: (c) => (c.rmis_status ? RMIS_RANK[c.rmis_status] ?? 9 : 9),
    type: 'num',
    defaultDir: 'asc',
  },
  status: {
    getValue: (c) =>
      (isBrokerwareDisabled(c.brokerware_status)
        ? c.brokerware_status ?? 'Disabled'
        : c.carrier_status ?? ''
      ).toLowerCase(),
    type: 'str',
    defaultDir: 'asc',
  },
  reviewed: {
    getValue: (c) => (c.last_reviewed ? Date.parse(c.last_reviewed) : null),
    type: 'num',
    defaultDir: 'desc',
  },
  revet: {
    getValue: (c) => {
      const r = computeRevetStatus(
        c.last_reviewed,
        c.created_at,
        c.revet_interval_days
      )
      return r.dueDate ? r.dueDate.getTime() : null
    },
    type: 'num',
    defaultDir: 'asc',
  },
}

function gapTone(gap: number | null): { tone: string; label: string } {
  if (gap === null || gap === undefined)
    return { tone: 'text-gray-400', label: '—' }
  if (gap >= 65) return { tone: 'text-green-700', label: formatScore(gap) }
  if (gap >= 60) return { tone: 'text-amber-600', label: formatScore(gap) }
  return { tone: 'text-red-600', label: formatScore(gap) }
}

// Last-hauled filter buckets.
const HAUL_PRESETS: { key: string; label: string; maxDays?: number; minDays?: number; never?: boolean }[] = [
  { key: 'le30', label: 'Hauled in last 30 days', maxDays: 30 },
  { key: 'le90', label: 'Hauled in last 90 days', maxDays: 90 },
  { key: 'le180', label: 'Hauled in last 6 months', maxDays: 180 },
  { key: 'le365', label: 'Hauled in last year', maxDays: 365 },
  { key: 'gt365', label: 'Last hauled over a year ago', minDays: 366 },
  { key: 'never', label: 'Never hauled (no DTS load)', never: true },
]

/** Does a carrier's last-hauled date satisfy the preset + custom from/to range? */
function passesHaul(
  lastHauledAt: string | null | undefined,
  preset: string,
  from: string,
  to: string
): boolean {
  const has = !!lastHauledAt
  const ts = has ? new Date(lastHauledAt as string).getTime() : null
  const days =
    ts != null ? Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000)) : null

  if (preset) {
    const p = HAUL_PRESETS.find((x) => x.key === preset)
    if (p) {
      if (p.never) {
        if (has) return false
      } else if (days == null) {
        return false // a date-based preset excludes never-hauled carriers
      } else {
        if (p.maxDays != null && days > p.maxDays) return false
        if (p.minDays != null && days < p.minDays) return false
      }
    }
  }
  // Custom range constrains further; a never-hauled carrier fails any from/to.
  if (from) {
    if (ts == null || ts < new Date(from).getTime()) return false
  }
  if (to) {
    // include the whole 'to' day
    if (ts == null || ts > new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1) return false
  }
  return true
}

// Shared column widths so the (fixed) header row and the virtualized body rows
// line up. Fixed widths sum to ~1000px; the carrier column flexes.
const COL = {
  select: 'w-8 shrink-0 pr-1',
  carrier: 'min-w-[180px] flex-1 pr-3',
  dot: 'w-24 shrink-0 pr-2',
  gap: 'w-16 shrink-0 pr-2 text-right',
  flagged: 'w-52 shrink-0 pr-2',
  insurance: 'w-44 shrink-0 pr-2',
  rmis: 'w-28 shrink-0 pr-2',
  status: 'w-44 shrink-0 pr-2',
  reviewed: 'w-28 shrink-0 pr-2',
  revet: 'w-28 shrink-0',
}

// Persisted list view (filters + scroll) so returning from a carrier detail
// page lands the user back exactly where they were instead of resetting.
const VIEW_KEY = 'dts.carrierTable.view.v1'

// The last-used "put on hold" note is remembered so the canned text is one edit
// away next time. Seeded with a neutral default the first time.
const HOLD_NOTE_KEY = 'dts.carrierTable.holdNote.v1'
const DEFAULT_HOLD_NOTE = INACTIVE_CARRIER_HOLD_NOTE
const DECLINE_NOTE_KEY = 'dts.carrierTable.declineNote.v1'
const DEFAULT_DECLINE_NOTE = ''

interface PersistedView {
  search: string
  status: StatusFilter
  sortKey: SortKey
  sortDir: SortDir
  revettingOnly: boolean
  problems: string[]
  businessTypes: string[]
  missingDocs: string[]
  haulPreset: string
  haulFrom: string
  haulTo: string
  scrollTop: number
}

function loadView(): Partial<PersistedView> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = sessionStorage.getItem(VIEW_KEY)
    return raw ? (JSON.parse(raw) as PersistedView) : {}
  } catch {
    return {}
  }
}

export function CarrierTable({
  carriers,
  lastUpload,
}: {
  carriers: CarrierSummary[]
  lastUpload: string | null
}) {
  const router = useRouter()
  // Hold the persisted view in a ref (reading sessionStorage in a ref is safe —
  // it doesn't affect rendered output). State is initialized to DEFAULTS so the
  // server-rendered HTML and the first client render are identical (no hydration
  // mismatch); the saved view is applied after mount, below. Initializing state
  // directly from sessionStorage caused the first render to diverge from the
  // server markup, which could break hydration on a stale/odd saved value.
  const savedRef = useRef<Partial<PersistedView> | undefined>(undefined)
  if (savedRef.current === undefined) savedRef.current = loadView()
  const saved = savedRef.current

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('BrokerwareActive')
  const [revettingOnly, setRevettingOnly] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [businessTypes, setBusinessTypes] = useState<string[]>([])
  const [missingDocs, setMissingDocs] = useState<string[]>([])
  // Last-hauled filter: a preset bucket plus an optional custom from/to range.
  const [haulPreset, setHaulPreset] = useState<string>('')
  const [haulFrom, setHaulFrom] = useState<string>('')
  const [haulTo, setHaulTo] = useState<string>('')
  const [sortKey, setSortKey] = useState<SortKey>('gap')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Bulk selection (by DOT) for mass status changes (e.g. put inactive carriers
  // On Hold). Kept separate from filters — it's an action layer, not a view.
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [bulkMode, setBulkMode] = useState<'hold' | 'decline' | null>(null)
  const [bulkNote, setBulkNote] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

  // Apply the persisted view once, right after mount (before paint), so filters
  // and sort are restored without a visible flash — but crucially not during the
  // hydration render. Each value is validated so a corrupt entry is ignored.
  const appliedViewRef = useRef(false)
  useLayoutEffect(() => {
    if (appliedViewRef.current) return
    appliedViewRef.current = true
    const v = saved
    if (typeof v.search === 'string') setSearch(v.search)
    if (v.status && STATUS_VALUES.has(v.status)) setStatus(v.status)
    if (typeof v.revettingOnly === 'boolean') setRevettingOnly(v.revettingOnly)
    if (Array.isArray(v.problems)) setProblems(v.problems.filter((x) => typeof x === 'string'))
    if (Array.isArray(v.businessTypes))
      setBusinessTypes(v.businessTypes.filter((x) => typeof x === 'string'))
    if (Array.isArray(v.missingDocs))
      setMissingDocs(v.missingDocs.filter((x) => typeof x === 'string'))
    if (typeof v.haulPreset === 'string') setHaulPreset(v.haulPreset)
    if (typeof v.haulFrom === 'string') setHaulFrom(v.haulFrom)
    if (typeof v.haulTo === 'string') setHaulTo(v.haulTo)
    if (v.sortKey && v.sortKey in SORT_COLS) setSortKey(v.sortKey)
    if (v.sortDir === 'asc' || v.sortDir === 'desc') setSortDir(v.sortDir)
  }, [saved])

  // Clicking a column header sorts by it; clicking the active column flips the
  // direction. A fresh column starts in its natural direction.
  const toggleSort = useCallback((col: SortKey) => {
    setSortKey((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setSortDir(SORT_COLS[col].defaultDir)
      return col
    })
  }, [])

  // Whether any carrier carries a Brokerware status yet. Until the Brokerware
  // sync has populated it, the "Active in Brokerware" filter falls back to
  // showing everything so the list isn't empty.
  const hasBrokerwareData = useMemo(
    () => carriers.some((c) => c.brokerware_status != null),
    [carriers]
  )

  // Base set: everything the search + status + revetting filters allow, before
  // the problem facet is applied. Facet counts are computed over this set so
  // they reflect the current view but aren't reduced by the problem selection.
  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = carriers.filter((c) => {
      if (q) {
        const hay = `${c.legal_name ?? ''} ${c.dba_name ?? ''} ${c.dot_number}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (revettingOnly && !c.requires_revetting) return false
      // Every filter except the ones that explicitly target the full roster
      // ("All") or disabled carriers ("Disabled") should show only carriers
      // Brokerware reports as Active — disabled/inactive carriers are noise for
      // Needs Review, Hard Stop, etc. Before the sync populates statuses, don't
      // gate (otherwise the list would be empty).
      if (
        status !== 'All' &&
        status !== 'Disabled' &&
        status !== 'OnHold' &&
        hasBrokerwareData &&
        !isBrokerwareActive(c.brokerware_status)
      ) {
        return false
      }
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
          // "Declined" now covers the former Declined / Suspended / Do Not Use.
          return (
            !!c.do_not_use ||
            c.carrier_status === 'Declined' ||
            c.carrier_status === 'Do Not Use' ||
            c.carrier_status === 'Suspended'
          )
        case 'OnHold':
          return c.carrier_status === 'On Hold'
        default:
          return true
      }
    })
    return rows
  }, [carriers, search, status, revettingOnly, hasBrokerwareData])

  // Per-problem carrier counts for the multi-select, over the base set.
  const facets = useMemo(() => problemFacets(base), [base])

  // Per-business-type counts, over the base set, most-common first.
  const businessTypeFacets = useMemo<FacetOption[]>(() => {
    const map = new Map<string, number>()
    for (const c of base) {
      const k = businessTypeKey(c)
      map.set(k, (map.get(k) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .map(([key, count]) => ({ key, label: businessTypeLabel(key), count }))
      .sort((a, b) => b.count - a.count)
  }, [base])

  // Per-missing-document counts, over the base set.
  const missingDocFacets = useMemo<FacetOption[]>(() => {
    const map = new Map<string, number>()
    for (const c of base) {
      for (const k of carrierMissingDocs(c)) {
        map.set(k, (map.get(k) ?? 0) + 1)
      }
    }
    return Object.keys(MISSING_DOC_LABELS)
      .filter((k) => map.has(k))
      .map((k) => ({ key: k, label: MISSING_DOC_LABELS[k], count: map.get(k)! }))
  }, [base])

  // Apply the selected problems (ANY match) and business types (membership),
  // then sort by the active column/direction.
  const filtered = useMemo(() => {
    let rows = base
    if (problems.length > 0) {
      rows = rows.filter((c) => {
        const keys = carrierProblems(c).map((p) => p.key)
        return problems.some((k) => keys.includes(k))
      })
    }
    if (businessTypes.length > 0) {
      rows = rows.filter((c) => businessTypes.includes(businessTypeKey(c)))
    }
    if (missingDocs.length > 0) {
      rows = rows.filter((c) => {
        const missing = carrierMissingDocs(c)
        return missingDocs.some((k) => missing.includes(k))
      })
    }
    if (haulPreset || haulFrom || haulTo) {
      rows = rows.filter((c) =>
        passesHaul(c.last_hauled_at, haulPreset, haulFrom, haulTo)
      )
    }

    const def = SORT_COLS[sortKey]
    const dir = sortDir === 'asc' ? 1 : -1
    rows = [...rows].sort((a, b) => {
      const av = def.getValue(a)
      const bv = def.getValue(b)
      const an = av === null || av === undefined
      const bn = bv === null || bv === undefined
      if (an && bn) return 0
      if (an) return 1 // nulls always last, regardless of direction
      if (bn) return -1
      const cmp =
        def.type === 'str'
          ? String(av).localeCompare(String(bv))
          : (av as number) - (bv as number)
      return cmp * dir
    })

    return rows
  }, [base, problems, businessTypes, missingDocs, haulPreset, haulFrom, haulTo, sortKey, sortDir])

  // Virtualize the rows so only what's on screen is rendered — smooth scrolling
  // even with the full 700+ carrier roster.
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 68,
    overscan: 12,
    initialOffset: saved.scrollTop ?? 0,
  })

  // Mobile renders a stacked card list that scrolls with the page, so it uses a
  // window virtualizer instead of the desktop table's inner-scroll one.
  const mobileListRef = useRef<HTMLDivElement>(null)
  const mobileVirtualizer = useWindowVirtualizer({
    count: filtered.length,
    estimateSize: () => 132,
    overscan: 6,
    scrollMargin: mobileListRef.current?.offsetTop ?? 0,
  })

  // Write the current view (filters + scroll) to sessionStorage so it survives
  // a round-trip to a carrier detail page.
  const persistView = useCallback(() => {
    try {
      sessionStorage.setItem(
        VIEW_KEY,
        JSON.stringify({
          search,
          status,
          sortKey,
          sortDir,
          revettingOnly,
          problems,
          businessTypes,
          missingDocs,
          haulPreset,
          haulFrom,
          haulTo,
          scrollTop: scrollRef.current?.scrollTop ?? 0,
        })
      )
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [
    search,
    status,
    sortKey,
    sortDir,
    revettingOnly,
    problems,
    businessTypes,
    missingDocs,
    haulPreset,
    haulFrom,
    haulTo,
  ])

  // Persist whenever a filter changes (covers navigating away via any link).
  useEffect(() => {
    persistView()
  }, [persistView])

  // Restore the saved scroll position once, after the first paint, when we're
  // returning to a previously-saved view.
  const restoredRef = useRef(false)
  useLayoutEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    const top = saved.scrollTop ?? 0
    if (top > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = top
    }
  }, [saved.scrollTop])

  // Navigate to a carrier, saving scroll position first so Back restores it.
  const openCarrier = useCallback(
    (dot: string) => {
      persistView()
      router.push(`/carriers/${dot}`)
    },
    [persistView, router]
  )

  // Whether any filter differs from the default view (controls the Clear button).
  const hasActiveFilters =
    search.trim() !== '' ||
    status !== 'BrokerwareActive' ||
    revettingOnly ||
    problems.length > 0 ||
    businessTypes.length > 0 ||
    missingDocs.length > 0 ||
    haulPreset !== '' ||
    haulFrom !== '' ||
    haulTo !== ''

  // Reset every filter back to the default view (sort is left untouched).
  const clearFilters = useCallback(() => {
    setSearch('')
    setStatus('BrokerwareActive')
    setRevettingOnly(false)
    setProblems([])
    setBusinessTypes([])
    setMissingDocs([])
    setHaulPreset('')
    setHaulFrom('')
    setHaulTo('')
  }, [])

  // Download the currently-visible rows as a CSV (opens in Excel).
  const exportCsv = useCallback(() => {
    const csv = buildCarrierCsv(filtered)
    const blob = new Blob(['﻿' + csv], {
      type: 'text/csv;charset=utf-8;',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `carriers-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [filtered])

  // ── Bulk selection ────────────────────────────────────────────────────────
  const selectedCount = selected.size
  // Are all currently-filtered rows selected? (drives the header checkbox)
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((c) => selected.has(c.dot_number))
  const someFilteredSelected =
    !allFilteredSelected && filtered.some((c) => selected.has(c.dot_number))

  const toggleOne = useCallback((dot: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(dot)) next.delete(dot)
      else next.add(dot)
      return next
    })
  }, [])

  // Select-all toggles every row in the *current filtered view* (not the whole
  // roster) — the intended workflow is "filter to the inactive ones, select all".
  const toggleAllFiltered = useCallback(() => {
    setSelected((prev) => {
      const everySelected =
        filtered.length > 0 && filtered.every((c) => prev.has(c.dot_number))
      const next = new Set(prev)
      if (everySelected) {
        for (const c of filtered) next.delete(c.dot_number)
      } else {
        for (const c of filtered) next.add(c.dot_number)
      }
      return next
    })
  }, [filtered])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  // Open the hold or decline confirmation, seeding the note editor with the
  // last-used text for that action (hold has a canned default; decline starts
  // blank so a real reason is written).
  const openBulk = useCallback((mode: 'hold' | 'decline') => {
    const key = mode === 'hold' ? HOLD_NOTE_KEY : DECLINE_NOTE_KEY
    let note = mode === 'hold' ? DEFAULT_HOLD_NOTE : DEFAULT_DECLINE_NOTE
    try {
      const saved = localStorage.getItem(key)
      if (saved && saved.trim()) note = saved
    } catch {
      /* ignore */
    }
    setBulkNote(note)
    setBulkError(null)
    setBulkMode(mode)
  }, [])

  // POST the selected DOTs to the bulk endpoint.
  const applyBulk = useCallback(
    async (action: 'hold' | 'unhold' | 'decline') => {
      const dots = Array.from(selected)
      if (dots.length === 0) return
      setBulkBusy(true)
      setBulkError(null)
      try {
        if (action === 'hold' || action === 'decline') {
          try {
            localStorage.setItem(
              action === 'hold' ? HOLD_NOTE_KEY : DECLINE_NOTE_KEY,
              bulkNote
            )
          } catch {
            /* ignore */
          }
        }
        const res = await fetch('/api/carriers/bulk-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dots,
            action,
            note: action === 'unhold' ? undefined : bulkNote,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Bulk update failed.')
        setBulkMode(null)
        setSelected(new Set())
        router.refresh() // reload server data so statuses reflect the change
      } catch (e) {
        setBulkError(e instanceof Error ? e.message : 'Bulk update failed.')
      } finally {
        setBulkBusy(false)
      }
    },
    [selected, bulkNote, router]
  )

  const th = (
    col: SortKey,
    label: string,
    className: string,
    alignRight = false
  ) => {
    const active = sortKey === col
    return (
      <div className={className}>
        <button
          type="button"
          onClick={() => toggleSort(col)}
          title={`Sort by ${label}`}
          className={cn(
            'group flex w-full items-center gap-1 uppercase tracking-wide transition hover:text-gray-700',
            alignRight ? 'justify-end' : 'justify-start',
            active && 'text-dts-blue'
          )}
        >
          <span>{label}</span>
          <span
            className={cn(
              'text-[9px] leading-none',
              active ? 'text-dts-blue' : 'text-gray-300 group-hover:text-gray-500'
            )}
          >
            {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
          </span>
        </button>
      </div>
    )
  }

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
            <option value="DoNotUse">Declined / Do Not Use</option>
            <option value="OnHold">On Hold</option>
            <option value="Disabled">Inactive / Disabled (Brokerware)</option>
          </Select>
        </div>
        <div className="pb-[1px]">
          <ProblemFilter
            facets={facets}
            selected={problems}
            onChange={setProblems}
          />
        </div>
        <div className="pb-[1px]">
          <FacetFilter
            label="Business Type"
            emptyText="Any business type"
            noun="business type"
            options={businessTypeFacets}
            selected={businessTypes}
            onChange={setBusinessTypes}
          />
        </div>
        <div className="pb-[1px]">
          <FacetFilter
            label="Missing Documents"
            emptyText="Any documents"
            noun="missing document"
            options={missingDocFacets}
            selected={missingDocs}
            onChange={setMissingDocs}
          />
        </div>
        <div className="w-48">
          <Select
            label="Last hauled"
            value={haulPreset}
            onChange={(e) => setHaulPreset(e.target.value)}
          >
            <option value="">Any last-hauled</option>
            {HAUL_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="pb-[1px]">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Last hauled range
          </label>
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={haulFrom}
              onChange={(e) => setHaulFrom(e.target.value)}
              aria-label="Last hauled from"
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
            <span className="text-xs text-gray-400">–</span>
            <input
              type="date"
              value={haulTo}
              onChange={(e) => setHaulTo(e.target.value)}
              aria-label="Last hauled to"
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
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
        <div className="ml-auto flex items-end gap-3 pb-2">
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <Button size="sm" variant="ghost" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={exportCsv}
              disabled={filtered.length === 0}
            >
              Export to Excel
            </Button>
          </div>
          <div className="text-right text-xs text-gray-500">
            <div>
              Last upload:{' '}
              <span className="font-medium text-gray-700">
                {lastUpload ? formatDate(lastUpload) : '—'}
              </span>
            </div>
            <div>{filtered.length} carrier(s) shown</div>
          </div>
        </div>
      </div>

      {/* Bulk action bar — appears once one or more carriers are selected. */}
      {selectedCount > 0 && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-dts-blue/20 bg-dts-blue/5 px-5 py-2.5">
          <span className="text-sm font-medium text-gray-800">
            {selectedCount} selected
          </span>
          <Button size="sm" variant="primary" onClick={() => openBulk('hold')}>
            Put on hold…
          </Button>
          <Button size="sm" variant="danger" onClick={() => openBulk('decline')}>
            Decline…
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (
                window.confirm(
                  `Take ${selectedCount} carrier(s) off hold? They'll move to Pending Review.`
                )
              )
                void applyBulk('unhold')
            }}
            disabled={bulkBusy}
          >
            Take off hold
          </Button>
          <button
            type="button"
            onClick={clearSelection}
            className="text-sm text-gray-500 hover:underline"
          >
            Clear selection
          </button>
          <span className="ml-auto text-xs text-gray-500">
            Updates this portal (CRM) only — not the TMS.
          </span>
        </div>
      )}

      {/* Desktop / tablet: full wide table (horizontal scroll if needed) */}
      <div className="hidden overflow-x-auto md:block">
        <div className="min-w-[1180px]">
          {/* Header row */}
          <div className="flex items-center border-b border-gray-100 px-5 py-2 text-xs font-semibold text-gray-500">
            <div className={COL.select}>
              <input
                type="checkbox"
                aria-label="Select all filtered carriers"
                title={
                  allFilteredSelected
                    ? 'Clear selection'
                    : `Select all ${filtered.length} shown`
                }
                checked={allFilteredSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someFilteredSelected
                }}
                onChange={toggleAllFiltered}
                className="h-4 w-4 rounded border-gray-300 text-dts-blue focus:ring-dts-blue"
              />
            </div>
            {th('carrier', 'Carrier', COL.carrier)}
            {th('dot', 'DOT', COL.dot)}
            {th('gap', 'GAP', COL.gap, true)}
            {th('flagged', 'Flagged Scores', COL.flagged)}
            {th('insurance', 'Insurance', COL.insurance)}
            {th('rmis', 'RMIS', COL.rmis)}
            {th('status', 'Status', COL.status)}
            {th('reviewed', 'Last Reviewed', COL.reviewed)}
            {th('revet', 'Re-vet', COL.revet)}
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
                      key={vi.key}
                      data-index={vi.index}
                      ref={rowVirtualizer.measureElement}
                      onClick={() => openCarrier(c.dot_number)}
                      className={cn(
                        'absolute left-0 top-0 flex w-full cursor-pointer items-start border-b border-gray-100 px-5 py-3 text-sm hover:bg-gray-50',
                        selected.has(c.dot_number) && 'bg-dts-blue/5'
                      )}
                      style={{ transform: `translateY(${vi.start}px)` }}
                    >
                      <div className={cn(COL.select, 'pt-0.5')} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.legal_name ?? c.dot_number}`}
                          checked={selected.has(c.dot_number)}
                          onChange={() => toggleOne(c.dot_number)}
                          className="h-4 w-4 rounded border-gray-300 text-dts-blue focus:ring-dts-blue"
                        />
                      </div>
                      <div className={COL.carrier}>
                        <Link
                          href={`/carriers/${c.dot_number}`}
                          className="font-medium text-gray-900 hover:text-dts-blue hover:underline"
                          onClick={(e) => {
                            e.stopPropagation()
                            persistView()
                          }}
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
                      <div className={cn(COL.dot, 'text-gray-600')}>
                        <div className="whitespace-nowrap">{c.dot_number}</div>
                        {mcDigits(c.mc_number) && (
                          <a
                            href={saferMcUrl(c.mc_number!)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Look up on FMCSA SAFER"
                            className="whitespace-nowrap text-xs text-dts-blue hover:underline"
                          >
                            MC {mcDigits(c.mc_number)}
                          </a>
                        )}
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
                        <div className="flex flex-wrap gap-1">
                          {c.rmis_status === 'certified' ? (
                            <Badge tone="green">Certified</Badge>
                          ) : c.rmis_status === 'not_certified' ? (
                            <Badge tone="gray">Not certified</Badge>
                          ) : c.rmis_status === 'not_in_rmis' ? (
                            <Badge tone="amber">Not in RMIS</Badge>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                          {c.eld_enrolled && <Badge tone="blue">ELD</Badge>}
                        </div>
                      </div>
                      <div className={COL.status}>
                        {disabled ? (
                          <Badge tone="gray" className="!whitespace-normal leading-tight">
                            {c.brokerware_status || 'Disabled'} (Brokerware)
                          </Badge>
                        ) : (
                          <Badge
                            tone={carrierStatusTone(c.carrier_status)}
                            className="!whitespace-normal leading-tight"
                          >
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

      {/* Mobile: stacked card list that scrolls with the page */}
      <div ref={mobileListRef} className="md:hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            No carriers match the current filters.
          </div>
        ) : (
          <div
            style={{
              height: mobileVirtualizer.getTotalSize(),
              position: 'relative',
              width: '100%',
            }}
          >
            {mobileVirtualizer.getVirtualItems().map((vi) => {
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
                  key={vi.key}
                  data-index={vi.index}
                  ref={mobileVirtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{
                    transform: `translateY(${
                      vi.start - mobileVirtualizer.options.scrollMargin
                    }px)`,
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => openCarrier(c.dot_number)}
                    className={cn(
                      'block w-full cursor-pointer border-b border-gray-100 px-4 py-3 text-left active:bg-gray-50',
                      selected.has(c.dot_number) && 'bg-dts-blue/5'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div
                        className="shrink-0 pt-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.legal_name ?? c.dot_number}`}
                          checked={selected.has(c.dot_number)}
                          onChange={() => toggleOne(c.dot_number)}
                          className="h-4 w-4 rounded border-gray-300 text-dts-blue focus:ring-dts-blue"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-gray-900">
                          {c.legal_name ?? `DOT ${c.dot_number}`}
                        </div>
                        {c.dba_name && c.dba_name !== c.legal_name && (
                          <div className="truncate text-xs text-gray-500">
                            dba {c.dba_name}
                          </div>
                        )}
                        <div className="mt-0.5 text-xs text-gray-400">
                          DOT {c.dot_number}
                          {c.city || c.state
                            ? ` · ${[c.city, c.state]
                                .filter(Boolean)
                                .join(', ')}`
                            : ''}
                        </div>
                        {mcDigits(c.mc_number) && (
                          <a
                            href={saferMcUrl(c.mc_number!)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="mt-0.5 inline-block text-xs text-dts-blue hover:underline"
                          >
                            MC {mcDigits(c.mc_number)} · SAFER
                          </a>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={cn(
                            'text-lg font-bold leading-none',
                            g.tone
                          )}
                        >
                          {g.label}
                        </div>
                        <div className="text-[10px] uppercase tracking-wide text-gray-400">
                          GAP
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {disabled ? (
                        <Badge tone="gray">
                          {c.brokerware_status || 'Disabled'}
                        </Badge>
                      ) : (
                        <Badge tone={carrierStatusTone(c.carrier_status)}>
                          {c.carrier_status ?? '—'}
                        </Badge>
                      )}
                      {c.rmis_status === 'certified' ? (
                        <Badge tone="green">RMIS Certified</Badge>
                      ) : c.rmis_status === 'not_in_rmis' ? (
                        <Badge tone="amber">Not in RMIS</Badge>
                      ) : c.rmis_status === 'not_certified' ? (
                        <Badge tone="gray">Not certified</Badge>
                      ) : null}
                      {c.eld_enrolled && <Badge tone="blue">ELD</Badge>}
                      {(c.hard_stops?.length ?? 0) > 0 ? (
                        <Badge tone="red">
                          {c.hard_stops!.length} hard stop(s)
                        </Badge>
                      ) : (
                        <>
                          <Badge tone={coverageStatusTone(c.auto_status)}>
                            Auto: {c.auto_status ?? '—'}
                          </Badge>
                          <Badge tone={coverageStatusTone(c.cargo_status)}>
                            Cargo: {c.cargo_status ?? '—'}
                          </Badge>
                        </>
                      )}
                      {!disabled && (
                        <Badge tone={REVET_TONE[rv.state]}>{rv.label}</Badge>
                      )}
                      {c.flagged_scores && c.flagged_scores.length > 0 && (
                        <Badge tone="amber">
                          {c.flagged_scores.length} flag(s)
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Bulk hold / decline confirmation + note editor. */}
      {bulkMode && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">
              {bulkMode === 'hold' ? 'Put' : 'Decline'} {selectedCount} carrier
              {selectedCount === 1 ? '' : 's'}
              {bulkMode === 'hold' ? ' on hold' : ''}
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              {bulkMode === 'hold' ? (
                <>
                  Sets status to <span className="font-medium">On Hold</span> and
                  pauses re-vet reminders. The note below is saved on each carrier
                  and to the audit log.
                </>
              ) : (
                <>
                  Sets status to <span className="font-medium">Declined</span> — an
                  adverse determination. The note below is saved on each carrier
                  and to the audit log.
                </>
              )}
            </p>
            <label className="mt-3 block text-xs font-medium text-gray-600">
              {bulkMode === 'hold' ? 'Note' : 'Reason'}
            </label>
            <textarea
              value={bulkNote}
              onChange={(e) => setBulkNote(e.target.value)}
              rows={4}
              placeholder={
                bulkMode === 'decline' ? 'Why these carriers are being declined…' : ''
              }
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-dts-blue focus:outline-none focus:ring-1 focus:ring-dts-blue"
            />
            <div className="mt-1 flex items-center justify-between">
              <p className="text-[11px] text-gray-400">
                Applies to this portal (CRM) only — the TMS is not changed.
              </p>
              {bulkMode === 'hold' && (
                <button
                  type="button"
                  onClick={() => setBulkNote(INACTIVE_CARRIER_HOLD_NOTE)}
                  className="text-[11px] font-medium text-dts-blue hover:underline"
                >
                  Use inactive-carrier template
                </button>
              )}
            </div>
            {bulkError && (
              <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {bulkError}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setBulkMode(null)}
                disabled={bulkBusy}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant={bulkMode === 'hold' ? 'primary' : 'danger'}
                onClick={() => applyBulk(bulkMode)}
                disabled={bulkBusy}
              >
                {bulkBusy
                  ? 'Applying…'
                  : bulkMode === 'hold'
                    ? 'Put on hold'
                    : 'Decline'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
