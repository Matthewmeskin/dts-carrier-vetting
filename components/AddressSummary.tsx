'use client'

import {
  formatAddress,
  hasAddress,
  isPoBox,
  sameAddress,
  type AddressParts,
} from '@/lib/addressCompare'

// The carrier's addresses, each labelled with its source, and how they relate:
// the physical address (where it operates, from FMCSA) first, then the mailing
// address and the Brokerware/TMS address only when they differ from it.
export function AddressSummary({
  physical,
  mailing,
  tms,
}: {
  physical: AddressParts
  mailing: AddressParts
  tms: AddressParts
}) {
  const hasPhys = hasAddress(physical)
  const hasMail = hasAddress(mailing)
  const hasTms = hasAddress(tms)
  if (!hasPhys && !hasMail && !hasTms) return null

  const mailingDiffers = hasMail && !sameAddress(mailing, physical)
  const tmsVsPhys = hasTms && sameAddress(tms, physical)
  const tmsVsMail = hasTms && sameAddress(tms, mailing)

  const rows: { label: string; addr: string; note: string; warn?: boolean }[] = []
  if (mailingDiffers) {
    rows.push({
      label: 'Mailing (RMIS / FMCSA)',
      addr: formatAddress(mailing),
      note: isPoBox(mailing) ? 'P.O. Box, mail only' : 'different from the physical address',
    })
  }
  if (hasTms && !tmsVsPhys) {
    rows.push({
      label: 'Brokerware / TMS',
      addr: formatAddress(tms),
      note: tmsVsMail
        ? 'same as the mailing address'
        : hasPhys
          ? "doesn't match FMCSA or RMIS: confirm which is current"
          : 'only address on file',
      warn: !tmsVsMail && hasPhys,
    })
  }

  return (
    <div className="mt-1 text-sm text-gray-600">
      {hasPhys ? (
        <div>
          {formatAddress(physical)}{' '}
          <span className="text-xs text-gray-400">
            Physical (FMCSA){tmsVsPhys ? ' · same in Brokerware' : ''}
            {hasMail && !mailingDiffers ? ' · also the mailing address' : ''}
          </span>
        </div>
      ) : (
        <div className="text-xs text-amber-700">No physical address from FMCSA or RMIS</div>
      )}
      {rows.length > 0 && (
        <dl className="mt-1 space-y-0.5 text-xs">
          {rows.map((r) => (
            <div key={r.label} className="flex flex-wrap gap-x-1.5">
              <dt className="text-gray-400">{r.label}:</dt>
              <dd className="text-gray-600">{r.addr}</dd>
              <dd className={r.warn ? 'font-medium text-amber-700' : 'text-gray-400'}>({r.note})</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
