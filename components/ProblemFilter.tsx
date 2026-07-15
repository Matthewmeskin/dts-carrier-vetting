'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { ProblemFacet, ProblemGroup } from '@/lib/problems'

// A multi-select popover that lists each problem with a live count of how many
// carriers have it. Selecting one or more filters the table to carriers that
// have any of the chosen problems.
export function ProblemFilter({
  facets,
  selected,
  onChange,
}: {
  facets: ProblemFacet[]
  selected: string[]
  onChange: (next: string[]) => void
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

  const groups: ProblemGroup[] = ['Hard Stop', 'RMIS', 'Insurance', 'Flagged Score']
  const groupHeading: Record<ProblemGroup, string> = {
    'Hard Stop': 'Hard Stops',
    'RMIS': 'RMIS Status',
    'Insurance': 'Insurance Renewal',
    'Flagged Score': 'Flagged Scores',
  }

  return (
    <div className="relative" ref={ref}>
      <label className="mb-1 block text-xs font-medium text-gray-600">
        Problems
      </label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-[38px] w-56 items-center justify-between rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50"
      >
        <span className={cn(selected.length === 0 && 'text-gray-400')}>
          {selected.length > 0
            ? `${selected.length} problem${selected.length === 1 ? '' : 's'} selected`
            : 'Any problem'}
        </span>
        <span className="ml-2 text-gray-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 max-h-96 w-80 overflow-y-auto rounded-md border border-gray-200 bg-white p-2 shadow-lg">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-xs font-semibold text-gray-500">
              Filter by problem
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

          {facets.length === 0 ? (
            <div className="px-1 py-3 text-xs text-gray-400">
              No problems in the current view.
            </div>
          ) : (
            groups.map((g) => {
              const items = facets.filter((f) => f.group === g)
              if (items.length === 0) return null
              return (
                <div key={g} className="mb-1">
                  <div className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    {groupHeading[g]}
                  </div>
                  {items.map((o) => (
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
                      <span className="flex-1 text-sm text-gray-700">
                        {o.label}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-xs font-semibold',
                          g === 'Hard Stop' || g === 'RMIS'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-700'
                        )}
                      >
                        {o.count}
                      </span>
                    </label>
                  ))}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
