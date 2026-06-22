export function AlertBanner({
  hardStops,
  flags,
}: {
  hardStops?: string[] | null
  flags?: string[] | null
}) {
  const hs = hardStops ?? []
  const fl = flags ?? []
  if (hs.length === 0 && fl.length === 0) return null

  return (
    <div className="space-y-3">
      {hs.length > 0 && (
        <div className="rounded-lg border-l-4 border-red-600 bg-red-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <span>⛔</span>
            Hard stop — do not use until resolved ({hs.length})
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-red-700">
            {hs.map((h, i) => (
              <li key={i}>{h}</li>
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
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
