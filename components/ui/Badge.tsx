import { cn } from '@/lib/utils'

export type BadgeTone =
  | 'green'
  | 'red'
  | 'amber'
  | 'gray'
  | 'blue'
  | 'maroon'

// Same tones as the Payables portal: a soft fill with a hairline ring.
const TONES: Record<BadgeTone, string> = {
  green: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  red: 'bg-red-50 text-red-800 ring-red-200',
  amber: 'bg-amber-50 text-amber-900 ring-amber-200',
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-brandblue-50 text-brandblue-800 ring-brandblue-200',
  maroon: 'bg-maroon-50 text-maroon-800 ring-maroon-200',
}

export function Badge({
  children,
  tone = 'gray',
  className,
}: {
  children: React.ReactNode
  tone?: BadgeTone
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold leading-4 ring-1 ring-inset',
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

/** Map a carrier_status string to a tone + label. */
export function carrierStatusTone(status?: string | null): BadgeTone {
  switch (status) {
    case 'Approved':
      return 'green'
    case 'Approved with Restrictions':
    case 'Exception Approved':
      return 'blue'
    case 'Pending Review':
      return 'amber'
    case 'On Hold':
      // Neutral/inactive — deliberately NOT red. A held carrier isn't declined,
      // it's parked and may be reactivated.
      return 'gray'
    case 'Declined':
    case 'Suspended':
    case 'Do Not Use':
      return 'red'
    default:
      return 'gray'
  }
}

/** Tone for an insurance coverage status. */
export function coverageStatusTone(status?: string | null): BadgeTone {
  if (!status) return 'gray'
  if (status === 'Valid') return 'green'
  if (status === 'No-Current-Info') return 'amber'
  return 'gray'
}
