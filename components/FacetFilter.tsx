'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface FacetOption {
  key: string
  label: string
  count: number
}

// A generic multi-select popover with a live count badge per option. Selecting
// one or more options filters to rows matching any of them.
export function FacetFilter({
  label,
  emptyText,
  noun,
  options,
  selected,
  onChange,
  width = 'w-56',
}: {
  label: string
  emptyText: string
  noun: string
  options: FacetOption[]
  selected: string[]
  onChange: (next: string[]) => void
  width?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function toggle(key: string) {
    onChange(
      selected.includes(key)
        ? selected.filter((k) => k !== key)
        : [...selected, key]
    )
  }

  return (
    <div className="relative" ref={ref}>
      <label className="mb-1 block text-xs font-medium text-gray-600">
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-[38px] items-center justify-between rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50',
          width
        )}
      >
        <span className={cn(selected.length === 0 && 'text-gray-400')}>
          {selected.length > 0
            ? `${selected.length} selected`
            : emptyText}
        </span>
        <span className="ml-2 text-gray-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 max-h-96 w-72 overflow-y-auto rounded-md border border-gray-200 bg-white p-2 shadow-lg">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-xs font-semibold text-gray-500">
              Filter by {noun}
            </span>
            {selected.length > 0 && (
              <button
                onClick={() => onChange([])}
                className="text-xs font-medium text-dts-blue hover:underline"
              >
                Clear ({selected.length})
              </button>
            )}
          </div>

          {options.length === 0 ? (
            <div className="px-1 py-3 text-xs text-gray-400">
              None in the current view.
            </div>
          ) : (
            options.map((o) => (
              <label
                key={o.key}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(o.key)}
                  onChange={() => toggle(o.key)}
                  className="h-4 w-4 rounded border-gray-300 text-dts-blue focus:ring-dts-blue"
                />
                <span className="flex-1 text-sm text-gray-700">{o.label}</span>
                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-600">
                  {o.count}
                </span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  )
}
