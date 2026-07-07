'use client'

import { CarrierEventRecord } from '@/lib/types'
import { Card, CardHeader, CardBody } from './ui/Card'
import { Badge, type BadgeTone } from './ui/Badge'
import { formatDateTime } from '@/lib/utils'

const TYPE_META: Record<string, { label: string; tone: BadgeTone }> = {
  recertification: { label: 'Recertified', tone: 'green' },
  status_change: { label: 'Status', tone: 'blue' },
  score_upload: { label: 'Scores', tone: 'gray' },
  score_flag: { label: 'Score flag', tone: 'amber' },
  rmis_refresh: { label: 'RMIS', tone: 'blue' },
  eld_flag: { label: 'ELD', tone: 'red' },
  sos_check: { label: 'SOS', tone: 'gray' },
  noa_check: { label: 'NOA', tone: 'blue' },
  insurance_change: { label: 'Insurance', tone: 'amber' },
}

function meta(type: string): { label: string; tone: BadgeTone } {
  return TYPE_META[type] ?? { label: type, tone: 'gray' }
}

export function ActivityLog({ events }: { events: CarrierEventRecord[] }) {
  return (
    <Card>
      <CardHeader
        title="Activity Log"
        subtitle="Timestamped record of recertifications, status changes, RMIS/ELD checks, and alerts"
      />
      <CardBody>
        {events.length === 0 ? (
          <p className="text-sm text-gray-500">
            No logged activity yet. Recertifications, status changes, RMIS
            refreshes, and ELD flags will appear here as they happen.
          </p>
        ) : (
          <ol className="relative space-y-3 border-l border-gray-200 pl-4">
            {events.map((e) => {
              const m = meta(e.event_type)
              return (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-gray-300" />
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={m.tone}>{m.label}</Badge>
                    <span className="text-xs text-gray-400">
                      {formatDateTime(e.created_at)}
                    </span>
                    {e.actor && (
                      <span className="text-xs text-gray-400">· {e.actor}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-gray-800">{e.summary}</p>
                </li>
              )
            })}
          </ol>
        )}
      </CardBody>
    </Card>
  )
}
