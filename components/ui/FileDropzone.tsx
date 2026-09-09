'use client'

import {
  forwardRef,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MutableRefObject,
} from 'react'
import { cn } from '@/lib/utils'

// Drag-and-drop file picker. Replaces the bare <input type="file"> ("Browse… /
// No file selected"), which gives users no hint that dropping a file works.
//
// Controlled: the caller owns `files` and gets `onChange` with the new list.
// The native input is kept (visually hidden) so click-to-browse, keyboard
// access and the caller's existing `ref` reset (`ref.current.value = ''`)
// all keep working. `accept` is enforced on drop as well — browsers only
// apply it to the file dialog, not to dropped files.

export interface FileDropzoneProps {
  files: File[]
  onChange: (files: File[]) => void
  multiple?: boolean
  accept?: string
  disabled?: boolean
  /** Short note on what's allowed, e.g. "PDF, JPG or PNG". */
  hint?: string
  className?: string
}

function matchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true
  const rules = accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (rules.length === 0) return true
  const name = file.name.toLowerCase()
  const type = (file.type || '').toLowerCase()
  return rules.some((r) => {
    if (r.startsWith('.')) return name.endsWith(r)
    if (r.endsWith('/*')) return type.startsWith(r.slice(0, -1))
    return type === r
  })
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const FileDropzone = forwardRef<HTMLInputElement, FileDropzoneProps>(
  function FileDropzone(
    { files, onChange, multiple = false, accept, disabled = false, hint, className },
    ref
  ) {
    const id = useId()
    const [over, setOver] = useState(false)
    const [skipped, setSkipped] = useState(0)

    // Keep our own handle on the input while still honoring the caller's ref.
    const innerRef = useRef<HTMLInputElement | null>(null)
    const setRefs = (el: HTMLInputElement | null) => {
      innerRef.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) (ref as MutableRefObject<HTMLInputElement | null>).current = el
    }

    const take = (list: FileList | File[] | null | undefined) => {
      const all = Array.from(list ?? [])
      const ok = all.filter((f) => matchesAccept(f, accept))
      setSkipped(all.length - ok.length)
      if (ok.length === 0) return
      onChange(multiple ? [...files, ...ok] : [ok[0]])
    }

    const onInput = (e: ChangeEvent<HTMLInputElement>) => {
      take(e.target.files)
      // Reset so picking the same file again still fires onChange.
      e.target.value = ''
    }

    const onDrop = (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setOver(false)
      if (disabled) return
      take(e.dataTransfer?.files)
    }
    const onDragOver = (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (!disabled && !over) setOver(true)
    }
    const onDragLeave = (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      // Moving between child elements fires leave/enter pairs — only clear the
      // highlight when the pointer actually exits the zone.
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setOver(false)
    }

    const remove = (i: number) => onChange(files.filter((_, idx) => idx !== i))

    return (
      <div className={className}>
        <label
          htmlFor={id}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragEnter={onDragOver}
          onDragLeave={onDragLeave}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-5 text-center transition-colors',
            over
              ? 'border-dts-blue bg-blue-50'
              : 'border-gray-300 bg-gray-50 hover:border-dts-blue/60 hover:bg-blue-50/40',
            disabled && 'cursor-not-allowed opacity-60'
          )}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn('h-6 w-6', over ? 'text-dts-blue' : 'text-gray-400')}
          >
            <path d="M12 16V4" />
            <path d="m7 9 5-5 5 5" />
            <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
          </svg>
          <span className="text-sm font-medium text-gray-800">
            {over ? 'Drop to attach' : `Drag & drop ${multiple ? 'files' : 'a file'} here`}
          </span>
          <span className="text-xs text-gray-500">
            or <span className="font-medium text-dts-blue underline">browse</span> to choose
            {hint ? ` · ${hint}` : ''}
          </span>
          <input
            id={id}
            ref={setRefs}
            type="file"
            multiple={multiple}
            accept={accept}
            disabled={disabled}
            onChange={onInput}
            className="sr-only"
          />
        </label>

        {skipped > 0 && (
          <p className="mt-1 text-xs text-amber-700">
            {skipped} file{skipped === 1 ? '' : 's'} skipped — unsupported type.
          </p>
        )}

        {files.length > 0 && (
          <ul className="mt-2 space-y-1">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${f.size}-${i}`}
                className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs"
              >
                <span className="truncate text-gray-800">{f.name}</span>
                <span className="shrink-0 text-gray-400">{fmtSize(f.size)}</span>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={disabled}
                  aria-label={`Remove ${f.name}`}
                  title="Remove"
                  className="ml-auto shrink-0 rounded px-1.5 text-base leading-none text-gray-400 hover:bg-gray-100 hover:text-red-600"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }
)
