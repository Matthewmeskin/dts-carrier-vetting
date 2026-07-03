// Brokerware stores a carrier's name as "Carrier Name/Factor Name" when the
// carrier's receivables are factored (e.g. "True Nation Inc/RTS Financial").
// This splits the raw name into the clean carrier name and the factor label.

export interface ParsedCarrierName {
  /** Clean carrier name with any "/Factor" suffix removed. */
  carrierName: string
  /** Factor label after the first "/", or null when the carrier isn't factored. */
  factorName: string | null
}

export function parseCarrierAndFactor(
  raw: string | null | undefined
): ParsedCarrierName {
  if (!raw) return { carrierName: '', factorName: null }
  const idx = raw.indexOf('/')
  if (idx === -1) {
    return { carrierName: raw.trim(), factorName: null }
  }
  const carrierName = raw.slice(0, idx).trim()
  const factorName = raw.slice(idx + 1).trim()
  return {
    carrierName: carrierName || raw.trim(),
    factorName: factorName || null,
  }
}
