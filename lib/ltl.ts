// LTL carriers recognised from Brokerware load history. When at least 90% of a
// carrier's loads over the last 12 months were LTL, air or parcel, policy
// Section 9 applies automatically: it moves freight under its own published
// tariff, so no broker-carrier agreement is expected, and the Bluewire,
// authority-age and inspection checks don't apply. Computed nightly and after
// each load sync by the refresh_carrier_mode_mix() database function.

export const LTL_SHARE = 0.9

export interface LtlFacts {
  loads: number
  ltlLoads: number
}

/** The carrier's LTL facts when it qualifies, otherwise null. */
export function ltlFacts(c: {
  ltl_auto?: boolean | null
  loads_12m?: number | null
  ltl_loads_12m?: number | null
} | null | undefined): LtlFacts | null {
  if (!c?.ltl_auto) return null
  return { loads: c.loads_12m ?? 0, ltlLoads: c.ltl_loads_12m ?? 0 }
}

export function ltlEvidence(f: LtlFacts): string {
  return `LTL carrier: ${f.ltlLoads} of ${f.loads} loads in the last 12 months were LTL, air or parcel`
}
