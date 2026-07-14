'use client'

import { useState } from 'react'
import { DeltaLogRecord } from '@/lib/types'
import { Card, CardHeader, CardBody } from './ui/Card'
import { Badge } from './ui/Badge'
import { cn, formatDateTime } from '@/lib/utils'

function entryTone(d: DeltaLogRecord): 'red' | 'amber' | 'green' {
  if ((d.hard_stops_detected?.length ?? 0) > 0) return 'red'
  if ((d.flags_detected?.length ?? 0) > 0) return 'amber'
  return 'green'
}

const BORDER: Record<'red' | 'amber' | 'green', string> = {
  red: 'border-red-500',
  amber: 'border-amber-500',
  green: 'border-green-500',
}

// A "quiet" entry is a routine refresh with nothing to report — no hard stops,
// no flags, and no field-level changes. Runs of these are collapsed so the
// meaningful entries stand out.
function isQuiet(d: DeltaLogRecord): boolean {
  return (
    (d.hard_stops_detected?.length ?? 0) === 0 &&
    (d.flags_detected?.length ?? 0) === 0 &&
    (d.change_summary?.length ?? 0) === 0
  )
}

type Group =
  | { quiet: true; entries: DeltaLogRecord[] }
  | { quiet: false; entry: DeltaLogRecord }

function groupEntries(entries: DeltaLogRecord[]): Group[] {
  const groups: Group[] = []
  for (const d of entries) {
    if (isQuiet(d)) {
      const last = groups[groups.length - 1]
      if (last && last.quiet) last.entries.push(d)
      else groups.push({ quiet: true, entries: [d] })
    } else {
      groups.push({ quiet: false, entry: d })
    }
  }
  return groups
}

function MeaningfulEntry({ d }: { d: DeltaLogRecord }) {
  const tone = entryTone(d)
  const changes = d.change_summary ?? []
  return (
    <li
      className={cn('rounded-md border-l-4 bg-gray-50 px-4 py-3', BORDER[tone])}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-600">
          {formatDateTime(d.detected_at)}
        </span>
        <div className="flex items-center gap-2">
          {(d.hard_stops_detected?.length ?? 0) > 0 && (
            <Badge tone="red">Hard stop</Badge>
          )}
          {(d.flags_detected?.length ?? 0) > 0 && <Badge tone="amber">Flag</Badge>}
          {d.alert_sent ? (
            <Badge tone="blue">Alert sent</Badge>
          ) : (
            <Badge tone="gray">No alert</Badge>
          )}
        </div>
      </div>

      {changes.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
          {changes.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}

      {(d.flags_detected?.length ?? 0) > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-amber-700">
          {d.flags_detected!.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}

      {(d.hard_stops_detected?.length ?? 0) > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-red-700">
          {d.hard_stops_detected!.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      )}
    </li>
  )
}

function QuietGroup({ entries }: { entries: DeltaLogRecord[] }) {
  const [open, setOpen] = useState(false)
  // entries are newest-first
  const newest = entries[0]
  const oldest = entries[entries.length - 1]
  const range =
    entries.length === 1
      ? formatDateTime(newest.detected_at)
      : `${formatDateTime(oldest.detected_at)} – ${formatDateTime(newest.detected_at)}`

  if (entries.length === 1) {
    // A lone quiet refresh: render as one compact line (nothing to collapse).
    return (
      <li className="rounded-md border-l-4 border-gray-200 bg-gray-50/60 px-4 py-2">
        <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
          <span>{formatDateTime(newest.detected_at)}</span>
          <span>Refreshed — no changes</span>
        </div>
      </li>
    )
  }

  return (
    <li className="rounded-md border-l-4 border-gray-200 bg-gray-50/60 px-4 py-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-xs font-medium text-gray-600">
          {entries.length} routine refreshes — no changes
        </span>
        <span className="text-xs text-gray-400">
          {range} <span className="ml-1">{open ? '▲' : '▾'}</span>
        </span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1 border-t border-gray-200 pt-2">
          {entries.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-2 text-xs text-gray-500"
            >
              <span>{formatDateTime(d.detected_at)}</span>
              <span>No field-level changes</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function DeltaTimeline({ entries }: { entries: DeltaLogRecord[] }) {
  const groups = groupEntries(entries)
  return (
    <Card>
      <CardHeader
        title="Change History"
        subtitle="RMIS Delta-detected changes for this carrier"
      />
      <CardBody>
        {entries.length === 0 ? (
          <p className="text-sm text-gray-500">No changes recorded yet.</p>
        ) : (
          <ol className="space-y-3">
            {groups.map((g, i) =>
              g.quiet ? (
                <QuietGroup key={`q${i}`} entries={g.entries} />
              ) : (
                <MeaningfulEntry key={g.entry.id} d={g.entry} />
              )
            )}
          </ol>
        )}
      </CardBody>
    </Card>
  )
}
