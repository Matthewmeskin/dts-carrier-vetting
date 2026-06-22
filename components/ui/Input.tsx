'use client'

import { cn } from '@/lib/utils'

const baseField =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-dts-blue focus:outline-none focus:ring-1 focus:ring-dts-blue disabled:bg-gray-50 disabled:text-gray-500'

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

export function Input({ label, className, id, ...props }: InputProps) {
  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={id}
          className="mb-1 block text-xs font-medium text-gray-600"
        >
          {label}
        </label>
      )}
      <input id={id} className={cn(baseField, className)} {...props} />
    </div>
  )
}

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
}

export function Textarea({ label, className, id, ...props }: TextareaProps) {
  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={id}
          className="mb-1 block text-xs font-medium text-gray-600"
        >
          {label}
        </label>
      )}
      <textarea id={id} className={cn(baseField, 'min-h-[80px]', className)} {...props} />
    </div>
  )
}

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
}

export function Select({ label, className, id, children, ...props }: SelectProps) {
  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={id}
          className="mb-1 block text-xs font-medium text-gray-600"
        >
          {label}
        </label>
      )}
      <select id={id} className={cn(baseField, 'cursor-pointer', className)} {...props}>
        {children}
      </select>
    </div>
  )
}
