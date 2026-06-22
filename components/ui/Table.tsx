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
    <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
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
        'whitespace-nowrap border-b border-gray-200 px-3 py-2.5 font-semibold',
        className
      )}
    >
      {children}
    </th>
  )
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-gray-100">{children}</tbody>
}

export function TR({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <tr className={cn('hover:bg-gray-50/70 transition', className)}>{children}</tr>
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
