'use client'

import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-dts-blue text-white hover:bg-[#00547f] disabled:bg-blue-300',
  secondary:
    'bg-dts-maroon text-white hover:bg-[#8c042b] disabled:bg-[#d98ba3]',
  outline:
    'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  ghost: 'bg-transparent text-gray-600 hover:bg-gray-100 disabled:opacity-50',
}

const SIZES: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-dts-blue/40',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    />
  )
}
