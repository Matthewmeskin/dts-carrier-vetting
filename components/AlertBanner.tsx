import { humanizeCode } from '@/lib/policyLabels'

export function AlertBanner({
  hardStops,
  flags,
  exceptionApproved = false,
  exceptionDays = null,
  exceptionAged = false,
}: {
  hardStops?: string[] | null
  flags?: string[] | null
  /** The carrier is Exception Approved: a reviewer has signed off with the
   *  stop documented, so it is shown as accepted-but-open rather than as a
   *  do-not-use alarm. It still shows, because RMIS still reports it. */
  exceptionApproved?: boolean
  /** Days since the exception was approved, when known. */
  exceptionDays?: number | null
  /** The exception has aged past the window with RMIS still not updated, so
   *  the stop is back to needs-action; shown red with the age called out. */
  exceptionAged?: boolean
}) {
  const hs = hardStops ?? []
  const fl = flags ?? []
  if (hs.length === 0 && fl.length === 0) return null
  const accepted = exceptionApproved && !exceptionAged

  return (
    <div className="space-y-3">
      {hs.length > 0 && exceptionAged && (
        <div className="rounded-lg border-l-4 border-red-600 bg-red-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <span>⛔</span>
            Hard stop — exception expired ({hs.length})
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-red-700">
            {hs.map((h, i) => (
              <li key={i}>{humanizeCode(h)}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-red-700">
            Approved as an exception{exceptionDays != null ? ` ${exceptionDays} days ago` : ''},
            but RMIS still shows the hard stop. That is past the window, so this
            carrier needs action again: chase the certificate with “Request COI
            from RMIS”, re-check with “Refresh from RMIS/SAFER”, or re-review the
            exception.
          </p>
        </div>
      )}
      {hs.length > 0 && accepted && (
        <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <span>⚠️</span>
            Hard stop accepted by exception ({hs.length}) — RMIS still not updated
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-amber-800">
            {hs.map((h, i) => (
              <li key={i}>{humanizeCode(h)}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-700">
            Approved as an exception with the certificate documented here. The
            stop is driven by the RMIS record and clears on its own once RMIS
            carries the certificate — use “Request COI from RMIS” if it hasn’t
            been sent, and “Refresh from RMIS/SAFER” to re-check.
          </p>
        </div>
      )}
      {hs.length > 0 && !exceptionApproved && !exceptionAged && (
        <div className="rounded-lg border-l-4 border-red-600 bg-red-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <span>⛔</span>
            Hard stop — do not use until resolved ({hs.length})
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-red-700">
            {hs.map((h, i) => (
              <li key={i}>{humanizeCode(h)}</li>
            ))}
          </ul>
        </div>
      )}
      {fl.length > 0 && (
        <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <span>⚠️</span>
            Flags requiring review ({fl.length})
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-amber-700">
            {fl.map((f, i) => (
              <li key={i}>{humanizeCode(f)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
