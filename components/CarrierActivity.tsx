'use client'

import { useState } from 'react'
import { DeltaLogRecord, CarrierEventRecord } from '@/lib/types'
import { Card, CardHeader, CardBody } from './ui/Card'
import { Badge, type BadgeTone } from './ui/Badge'
import { cn, formatDateTime } from '@/lib/utils'

// One unified carrier timeline: RMIS delta changes + the semantic event log,
// merged chronologically. Overlapping entries (an ELD fraud signal is logged to
// both the delta log and the event log) are de-duplicated so each shows once.

interface Item {
  key: string
  at: string
  tone: BadgeTone
  badge: string | null
  actor?: string | null
  text?: string
  bullets?: string[]
  quiet: boolean
}

const EVENT_META: Record<string, { label: string; tone: BadgeTone }> = {
  recertification: { label: 'Recertified', tone: 'green' },
  status_change: { label: 'Status', tone: 'blue' },
  score_upload: { label: 'Scores', tone: 'gray' },
  score_flag: { label: 'Score flag', tone: 'amber' },
  rmis_refresh: { label: 'RMIS', tone: 'blue' },
  eld_flag: { label: 'ELD', tone: 'red' },
  sos_check: { label: 'SOS', tone: 'gray' },
  noa_check: { label: 'NOA', tone: 'blue' },
  insurance_change: { label: 'Insurance', tone: 'amber' },
  insurance_refresh_request: { label: 'Insurance', tone: 'blue' },
  insurance_refresh_response: { label: 'RMIS reply', tone: 'green' },
  hard_stop: { label: 'Hard stop', tone: 'red' },
  checklist_change: { label: 'Checklist', tone: 'blue' },
  document_upload: { label: 'Document', tone: 'blue' },
}

const DOT: Record<BadgeTone, string> = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  green: 'bg-green-500',
  blue: 'bg-dts-blue',
  gray: 'bg-gray-300',
  maroon: 'bg-dts-maroon',
}

/** Group a timestamp to the minute so the same event logged to both tables
 *  within the same minute collapses to one entry. */
function minuteKey(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 16)
}

function buildItems(
  deltaLog: DeltaLogRecord[],
  events: CarrierEventRecord[]
): Item[] {
  const items: Item[] = []
  const seenEld = new Set<string>()

  // Events first — they own the semantic categories (ELD, recert, insurance…).
  for (const e of events) {
    const m = EVENT_META[e.event_type] ?? { label: e.event_type, tone: 'gray' as BadgeTone }
    if (e.event_type === 'eld_flag') seenEld.add(minuteKey(e.created_at))
    items.push({
      key: `e:${e.id}`,
      at: e.created_at,
      tone: m.tone,
      badge: m.label,
      actor: e.actor,
      text: e.summary,
      quiet: false,
    })
  }

  // Delta entries — RMIS field changes + routine refreshes. Skip an ELD delta
  // when the matching ELD event is already shown (same minute).
  for (const d of deltaLog) {
    const changes = d.change_summary ?? []
    const flags = d.flags_detected ?? []
    const hardStops = d.hard_stops_detected ?? []
    const isEld = changes.some((c) => /\bELD\b/i.test(c))

    if (isEld) {
      if (seenEld.has(minuteKey(d.detected_at))) continue
      seenEld.add(minuteKey(d.detected_at))
      items.push({
        key: `d:${d.id}`,
        at: d.detected_at,
        tone: 'amber',
        badge: 'ELD',
        text: changes.join(' '),
        quiet: false,
      })
      continue
    }

    const bullets = [...changes, ...flags, ...hardStops]
    if (bullets.length === 0) {
      items.push({
        key: `d:${d.id}`,
        at: d.detected_at,
        tone: 'gray',
        badge: null,
        text: 'Refreshed — no changes',
        quiet: true,
      })
      continue
    }
    items.push({
      key: `d:${d.id}`,
      at: d.detected_at,
      tone: hardStops.length ? 'red' : flags.length ? 'amber' : 'gray',
      badge: hardStops.length ? 'Hard stop' : flags.length ? 'Flag' : 'RMIS',
      bullets,
      quiet: false,
    })
  }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  return items
}

type Group = { quiet: true; items: Item[] } | { quiet: false; item: Item }

function groupQuiet(items: Item[]): Group[] {
  const groups: Group[] = []
  for (const it of items) {
    if (it.quiet) {
      const last = groups[groups.length - 1]
      if (last && last.quiet) last.items.push(it)
      else groups.push({ quiet: true, items: [it] })
    } else {
      groups.push({ quiet: false, item: it })
    }
  }
  return groups
}

function Row({ item }: { item: Item }) {
  return (
    <li className="relative">
      <span
        className={cn(
          'absolute -left-[21px] top-1.5 h-2 w-2 rounded-full',
          DOT[item.tone]
        )}
      />
      <div className="flex flex-wrap items-center gap-2">
        {item.badge && <Badge tone={item.tone}>{item.badge}</Badge>}
        <span className="text-xs text-gray-400">{formatDateTime(item.at)}</span>
        {item.actor && <span className="text-xs text-gray-400">· {item.actor}</span>}
      </div>
      {item.text && <p className="mt-0.5 text-sm text-gray-800">{item.text}</p>}
      {item.bullets && item.bullets.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
          {item.bullets.map((b, i) => (
            <li
              key={i}
              className={cn(
                item.tone === 'red'
                  ? 'text-red-700'
                  : item.tone === 'amber'
                    ? 'text-amber-700'
                    : 'text-gray-700'
              )}
            >
              {b}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function QuietGroup({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false)
  if (items.length === 1) {
    return (
      <li className="relative">
        <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-gray-200" />
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>{formatDateTime(items[0].at)}</span>
          <span>· Refreshed — no changes</span>
        </div>
      </li>
    )
  }
  const newest = items[0]
  const oldest = items[items.length - 1]
  return (
    <li className="relative">
      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-gray-200" />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left text-xs text-gray-500"
      >
        <span>{items.length} routine refreshes — no changes</span>
        <span className="text-gray-400">
          {formatDateTime(oldest.at)} – {formatDateTime(newest.at)}{' '}
          <span className="ml-1">{open ? '▲' : '▾'}</span>
        </span>
      </button>
      {open && (
        <ul className="mt-1 space-y-1">
          {items.map((it) => (
            <li key={it.key} className="text-xs text-gray-400">
              {formatDateTime(it.at)} · no changes
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function CarrierActivity({
  deltaLog,
  events,
}: {
  deltaLog: DeltaLogRecord[]
  events: CarrierEventRecord[]
}) {
  const groups = groupQuiet(buildItems(deltaLog, events))
  return (
    <Card>
      <CardHeader
        title="Activity"
        subtitle="RMIS changes, checks, recertifications, and alerts for this carrier"
      />
      <CardBody>
        {groups.length === 0 ? (
          <p className="text-sm text-gray-500">
            No activity recorded yet. RMIS changes, recertifications, status
            changes, and ELD/insurance checks will appear here as they happen.
          </p>
        ) : (
          <ol className="relative space-y-3 border-l border-gray-200 pl-4">
            {groups.map((g, i) =>
              g.quiet ? (
                <QuietGroup key={`q${i}`} items={g.items} />
              ) : (
                <Row key={g.item.key} item={g.item} />
              )
            )}
          </ol>
        )}
      </CardBody>
    </Card>
  )
}
