import { cn } from '@/lib/utils'

export function Table({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className="scrollbar-thin w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)}>
        {children}
      </table>
    </div>
  )
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="bg-slate-50/70 text-left font-heading text-2xs font-semibold uppercase tracking-wider text-ink-faint">
      {children}
    </thead>
  )
}

export function TH({
  children,
  className,
}: {
  children?: React.ReactNode
  className?: string
}) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b border-line px-3 py-2 font-semibold',
        className
      )}
    >
      {children}
    </th>
  )
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-line/70">{children}</tbody>
}

export function TR({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}) {
  return (
    <tr
      className={cn('transition hover:bg-slate-50', className)}
      onClick={onClick}
    >
      {children}
    </tr>
  )
}

export function TD({
  children,
  className,
}: {
  children?: React.ReactNode
  className?: string
}) {
  return (
    <td className={cn('px-3 py-2.5 align-middle text-gray-700', className)}>
      {children}
    </td>
  )
}
