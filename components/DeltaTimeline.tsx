'use client'

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

export function DeltaTimeline({ entries }: { entries: DeltaLogRecord[] }) {
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
            {entries.map((d) => {
              const tone = entryTone(d)
              const changes = d.change_summary ?? []
              return (
                <li
                  key={d.id}
                  className={cn(
                    'rounded-md border-l-4 bg-gray-50 px-4 py-3',
                    BORDER[tone]
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-gray-600">
                      {formatDateTime(d.detected_at)}
                    </span>
                    <div className="flex items-center gap-2">
                      {(d.hard_stops_detected?.length ?? 0) > 0 && (
                        <Badge tone="red">Hard stop</Badge>
                      )}
                      {(d.flags_detected?.length ?? 0) > 0 && (
                        <Badge tone="amber">Flag</Badge>
                      )}
                      {d.alert_sent ? (
                        <Badge tone="blue">Alert sent</Badge>
                      ) : (
                        <Badge tone="gray">No alert</Badge>
                      )}
                    </div>
                  </div>

                  {changes.length > 0 ? (
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
                      {changes.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-gray-500">
                      Record refreshed — no field-level changes detected.
                    </p>
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
            })}
          </ol>
        )}
      </CardBody>
    </Card>
  )
}
