// Known RMIS policy codes → human-readable text. The live rmisEvaluator emits
// full sentences (which pass through untouched); short snake_case codes get
// mapped here so nothing renders as raw data.
const CODE_LABELS: Record<string, string> = {
  // Hard stops
  inactive_authority: 'No active operating authority',
  out_of_service: 'Carrier is under an out-of-service order',
  conditional_safety_rating: 'Conditional safety rating',
  unsatisfactory_safety_rating: 'Unsatisfactory safety rating',
  insufficient_auto_coverage: 'Auto liability coverage below the $1M minimum',
  insufficient_cargo_coverage: 'Cargo coverage below the $100K minimum',
  auto_coverage_inactive: 'Auto liability coverage is inactive',
  cargo_coverage_inactive: 'Cargo coverage is inactive',
  authority_under_90_days: 'Authority under 90 days old',
  identity_unverified: 'Carrier identity could not be verified',
  double_brokering: 'Suspected double-brokering',
  fraud_indicator: 'Unresolved fraud or identity concern',
  do_not_use: 'Carrier is marked Do Not Use',
  // Flags
  authority_under_365_days: 'Authority under 365 days old',
  prior_authority_revocation: 'Prior authority revocation on record',
  missing_broker_carrier_agreement: 'No broker-carrier agreement on file',
  missing_w9: 'W-9 not on file',
  w9_name_mismatch: 'W-9 business name may not match FMCSA legal name',
  factoring_unverified: 'Factoring — verify Notice of Assignment & pay-to entity',
  zero_inspections: 'Zero roadside inspections on record',
  zero_inspections_lookback: 'Zero roadside inspections in lookback period',
  oos_ratio_elevated: 'Out-of-service ratio above national average',
  high_crash_count: 'Elevated crash count',
  fatal_crash: 'Fatal crash on record',
  general_liability_missing: 'General liability not on file (preferred $1M/$2M)',
  low_insurance_confidence: 'Insurance confidence below "High" in RMIS',
}

function humanizeCode(raw: string): string {
  const trimmed = raw.trim()
  // Already a human sentence (the live evaluator output) — leave it alone.
  if (/\s/.test(trimmed) && !/^[a-z0-9_]+$/.test(trimmed)) return trimmed
  const key = trimmed.toLowerCase()
  if (CODE_LABELS[key]) return CODE_LABELS[key]
  // Fallback: de-underscore and sentence-case.
  const words = key.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

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
