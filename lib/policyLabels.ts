// Shared human-readable labels for RMIS policy codes. The live rmisEvaluator
// emits full sentences (which pass through untouched); short snake_case codes
// get mapped here so nothing renders as raw data.
export const CODE_LABELS: Record<string, string> = {
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

export function humanizeCode(raw: string): string {
  const trimmed = raw.trim()
  // Already a human sentence (the live evaluator output) — leave it alone.
  if (/\s/.test(trimmed) && !/^[a-z0-9_]+$/.test(trimmed)) return trimmed
  const key = trimmed.toLowerCase()
  if (CODE_LABELS[key]) return CODE_LABELS[key]
  const words = key.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
