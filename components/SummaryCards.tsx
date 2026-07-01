import { Card } from './ui/Card'
import { cn } from '@/lib/utils'

export interface Metrics {
  totalCarriers: number
  requireRevetting: number
  hardStopsActive: number
  changesThisWeek: number
  dueForRevet: number
}

const CARDS: {
  key: keyof Metrics
  label: string
  accent: string
}[] = [
  { key: 'totalCarriers', label: 'Total Carriers', accent: 'text-dts-blue' },
  {
    key: 'dueForRevet',
    label: 'Due for Re-vet',
    accent: 'text-orange-600',
  },
  {
    key: 'requireRevetting',
    label: 'Require Revetting',
    accent: 'text-amber-600',
  },
  { key: 'hardStopsActive', label: 'Hard Stops Active', accent: 'text-red-600' },
  {
    key: 'changesThisWeek',
    label: 'Changes This Week',
    accent: 'text-dts-darkblue',
  },
]

export function SummaryCards({
  metrics,
  loading,
}: {
  metrics: Metrics | null
  loading?: boolean
}) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {CARDS.map((c) => (
        <Card key={c.key} className="px-5 py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {c.label}
          </div>
          <div className={cn('mt-1 text-3xl font-bold', c.accent)}>
            {loading || !metrics ? (
              <span className="text-gray-300">—</span>
            ) : (
              metrics[c.key]
            )}
          </div>
        </Card>
      ))}
    </div>
  )
}
