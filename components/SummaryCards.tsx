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
  { key: 'totalCarriers', label: 'Total Carriers', accent: 'border-l-brandblue text-brandblue' },
  { key: 'dueForRevet', label: 'Due for Re-vet', accent: 'border-l-amber-500 text-amber-700' },
  { key: 'requireRevetting', label: 'Require Revetting', accent: 'border-l-amber-500 text-amber-700' },
  { key: 'hardStopsActive', label: 'Hard Stops Active', accent: 'border-l-maroon text-maroon' },
  { key: 'changesThisWeek', label: 'Changes This Week', accent: 'border-l-slate-400 text-ink' },
]

export function SummaryCards({
  metrics,
  loading,
}: {
  metrics: Metrics | null
  loading?: boolean
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {CARDS.map((c) => (
        <Card key={c.key} className={cn('border-l-4 px-4 py-3', c.accent)}>
          <div className="text-2xs font-medium uppercase tracking-wider text-ink-muted">
            {c.label}
          </div>
          <div className={cn('mt-0.5 font-heading text-2xl font-semibold tabular-nums', c.accent)}>
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
