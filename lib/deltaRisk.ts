// Severity of a carrier change, per the DTS vetting framework:
//  - at_risk: a change introduced a hard stop (fails the framework — do not use)
//  - flag:    a change introduced a flag requiring review
//  - info:    a status change with no hard stop or flag
export type DeltaSeverity = 'at_risk' | 'flag' | 'info'

export function classifyDelta(entry: {
  hard_stops_detected?: string[] | null
  flags_detected?: string[] | null
}): DeltaSeverity {
  if ((entry.hard_stops_detected?.length ?? 0) > 0) return 'at_risk'
  if ((entry.flags_detected?.length ?? 0) > 0) return 'flag'
  return 'info'
}

export const DELTA_SEVERITY_LABEL: Record<DeltaSeverity, string> = {
  at_risk: 'At risk — hard stop',
  flag: 'Needs review',
  info: 'Informational',
}
