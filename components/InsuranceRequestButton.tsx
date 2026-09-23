'use client'

import { useState } from 'react'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'
import { cn } from '@/lib/utils'

// Ask RMIS (Truckstop) to pull this carrier's certificate of insurance, on
// demand. The nightly batch only chases coverage that is due to EXPIRE; this
// covers the case the batch can't — coverage that is missing outright ("Empty",
// "No-Current-Info") while someone here already has the certificate in hand and
// needs RMIS to carry it, which is what actually clears the hard stop.

type Key = 'auto' | 'cargo' | 'general'

const COVERAGES: { key: Key; label: string }[] = [
  { key: 'auto', label: 'Auto liability' },
  { key: 'cargo', label: 'Cargo' },
  { key: 'general', label: 'General liability' },
]

/** A status that means RMIS has nothing usable on file, so this coverage is
 *  worth asking about by default. */
function needsRequest(status: string | null | undefined): boolean {
  const s = (status ?? '').toLowerCase()
  if (!s) return true
  return !s.includes('valid') || s.includes('expire')
}

export function InsuranceRequestButton({
  dot,
  autoStatus,
  cargoStatus,
  generalStatus,
  onSent,
  size = 'sm',
  className,
}: {
  dot: string
  autoStatus?: string | null
  cargoStatus?: string | null
  generalStatus?: string | null
  onSent?: () => void | Promise<void>
  size?: 'sm' | 'md'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const statusOf = (k: Key) =>
    k === 'auto' ? autoStatus : k === 'cargo' ? cargoStatus : generalStatus
  // Pre-tick whatever currently isn't valid — usually exactly what's wanted.
  const [picked, setPicked] = useState<Set<Key>>(
    () => new Set(COVERAGES.filter((c) => needsRequest(statusOf(c.key))).map((c) => c.key))
  )
  const [note, setNote] = useState('')

  const toggle = (k: Key) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  async function send() {
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/carriers/${dot}/insurance-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coverages: Array.from(picked),
          note: note.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setDone(`Requested from ${data.to}.`)
      setOpen(false)
      setNote('')
      await onSent?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={className}>
      <Button
        size={size}
        variant="outline"
        onClick={() => {
          setDone(null)
          setError(null)
          setOpen(true)
        }}
      >
        Request COI from RMIS
      </Button>
      {done && (
        <p className="mt-1 max-w-[16rem] text-right text-xs text-green-700">{done}</p>
      )}
      {!open && error && (
        <p className="mt-1 max-w-[16rem] text-right text-xs text-red-600">{error}</p>
      )}

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 text-left shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">
              Request certificate from RMIS
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              Emails RMIS support (Truckstop) asking them to pull this carrier&apos;s
              certificate. Their reply is captured back into this carrier&apos;s
              activity log.
            </p>

            <fieldset className="mt-4">
              <legend className="text-xs font-medium text-gray-600">Coverage</legend>
              <div className="mt-1.5 space-y-1.5">
                {COVERAGES.map((c) => {
                  const status = statusOf(c.key)
                  return (
                    <label key={c.key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={picked.has(c.key)}
                        onChange={() => toggle(c.key)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <span className="text-gray-800">{c.label}</span>
                      <span
                        className={cn(
                          'text-xs',
                          needsRequest(status) ? 'text-red-600' : 'text-gray-400'
                        )}
                      >
                        {status ? `· ${status}` : '· no record'}
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <label className="mt-4 block">
              <span className="text-xs font-medium text-gray-600">
                Note to RMIS (optional)
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="e.g. The carrier sent us their 2026-2027 cargo COI directly — please pull it into RMIS."
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-dts-blue focus:outline-none focus:ring-1 focus:ring-dts-blue"
              />
            </label>

            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={sending}>
                Cancel
              </Button>
              <Button onClick={send} disabled={sending || picked.size === 0}>
                {sending ? <Spinner size={14} /> : null}
                {sending ? 'Sending…' : 'Send request'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
