'use client'

import { useEffect, useState } from 'react'
import { cn, formatCurrency, formatDate, formatRelative } from '@/lib/utils'
import { propertySignals, type PropertyRecord as Rec } from '@/lib/propertySignals'

interface Check {
  address: string
  checked_at: string
  found: boolean
  record: Rec | null
  error: string | null
  checked_by: string | null
}

// County dates arrive as UTC midnight; format the calendar day itself.
const day = (iso: string) => formatDate(iso.slice(0, 10))

const tone = {
  high: 'border-red-200 bg-red-50 text-red-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  info: 'border-gray-200 bg-gray-50 text-gray-700',
}

// County property record for the FMCSA address: who owns it, what kind of
// property it is and when it last sold. A house that sold after the carrier
// got its authority is the classic sign of an abandoned address.
export function PropertyRecord({
  dot,
  names,
  authorityDate,
}: {
  dot: string
  names: (string | null | undefined)[]
  authorityDate?: string | null
}) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [check, setCheck] = useState<Check | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/carriers/${dot}/property`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        setConfigured(Boolean(d.configured))
        setCheck(d.check ?? null)
      })
      .catch(() => alive && setConfigured(false))
    return () => {
      alive = false
    }
  }, [dot])

  async function lookup(force: boolean) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/carriers/${dot}/property`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || `Lookup failed (${res.status})`)
      setCheck(d.check)
      if (d.error) setError(d.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLoading(false)
    }
  }

  if (configured === false) return null

  const r = check?.found ? check.record : null
  const signals = propertySignals(r, { names, authorityDate })

  return (
    <div className="mt-4 rounded-md border border-gray-200 p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-900">Property record</h4>
        <div className="flex items-center gap-3 text-xs">
          {check && (
            <span className="text-gray-400">
              {check.record?.source === 'smarty'
                ? 'County deed records'
                : 'County tax records'}{' '}
              · checked {formatRelative(check.checked_at)}
            </span>
          )}
          <button
            type="button"
            disabled={loading || configured === null}
            onClick={() => lookup(!!check)}
            className="font-medium text-dts-blue hover:underline disabled:opacity-50"
          >
            {loading ? 'Looking up…' : check ? 'Re-check' : 'Look up owner & sale history'}
          </button>
        </div>
      </div>

      {error && <p className="mb-2 text-xs text-red-700">{error}</p>}

      {!check && !loading && (
        <p className="text-xs text-gray-500">
          Pulls the owner of record, property type and sale history for this
          address from county records.
        </p>
      )}

      {check && !check.found && !check.error && (
        <p className="text-xs text-gray-500">
          No county property record matched {check.address}. Common for suites,
          truck yards and new construction; a mailbox store won’t have one either.
        </p>
      )}

      {r && (
        <>
          {signals.length > 0 && (
            <ul className="mb-3 space-y-1.5">
              {signals.map((s, i) => (
                <li key={i} className={cn('rounded-md border px-2.5 py-1.5 text-xs', tone[s.level])}>
                  {s.text}
                </li>
              ))}
            </ul>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-gray-500">Property type</dt>
              <dd className="text-gray-900">{r.propertyType || '—'}</dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-xs text-gray-500">
                {r.ownerFromDeed ? 'Owner (latest deed)' : 'Owner of record'}
              </dt>
              <dd className="text-gray-900">
                {r.ownerNames.join(', ') || '—'}
                {r.ownerType && <span className="text-xs text-gray-500"> ({r.ownerType})</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Last sold</dt>
              <dd className="text-gray-900">
                {r.lastSaleDate ? day(r.lastSaleDate) : '—'}
                {r.lastSalePrice ? (
                  <span className="text-xs text-gray-500"> · {formatCurrency(r.lastSalePrice)}</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Owner lives there</dt>
              <dd className="text-gray-900">
                {r.ownerOccupied == null ? '—' : r.ownerOccupied ? 'Yes' : 'No'}
              </dd>
            </div>
          </dl>
          {r.deedDocumentNumber && (
            <p className="mt-2 text-xs text-gray-500">
              Latest deed: document {r.deedDocumentNumber}
              {r.lastSaleDate ? `, recorded ${day(r.lastSaleDate)}` : ''}
            </p>
          )}
          {r.ownerMailingAddress && r.ownerOccupied === false && (
            <p className="mt-2 text-xs text-gray-500">
              Owner’s mailing address: {r.ownerMailingAddress}
            </p>
          )}
          {r.sales.length > 1 && (
            <p className="mt-2 text-xs text-gray-500">
              Sale history:{' '}
              {r.sales
                .slice(0, 5)
                .map((s) => `${day(s.date)}${s.price ? ` (${formatCurrency(s.price)})` : ''}`)
                .join(' · ')}
            </p>
          )}
        </>
      )}
    </div>
  )
}
