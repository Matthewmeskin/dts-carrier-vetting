import { cn } from '@/lib/utils'

export type BadgeTone =
  | 'green'
  | 'red'
  | 'amber'
  | 'gray'
  | 'blue'
  | 'maroon'

const TONES: Record<BadgeTone, string> = {
  green: 'bg-green-100 text-green-800 border-green-200',
  red: 'bg-red-100 text-red-800 border-red-200',
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  gray: 'bg-gray-100 text-gray-700 border-gray-200',
  blue: 'bg-blue-100 text-blue-800 border-blue-200',
  maroon: 'bg-[#fbe7ee] text-dts-maroon border-[#f3c6d5]',
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
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
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
