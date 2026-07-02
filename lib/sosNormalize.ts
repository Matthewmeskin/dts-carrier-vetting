// Helpers for Secretary-of-State entity matching: a stable dedup key for factor
// names (so many carriers sharing one factor collapse to a single row) and a
// best-effort state inference from a free-text address.

const ENTITY_SUFFIXES = [
  'incorporated',
  'corporation',
  'company',
  'limited liability company',
  'limited liability',
  'limited partnership',
  'limited',
  'inc',
  'llc',
  'l l c',
  'corp',
  'co',
  'ltd',
  'lp',
  'llp',
  'pllc',
  'plc',
  'dba',
]

/**
 * Normalize an entity name into a stable dedup key: lowercased, punctuation
 * stripped, common corporate suffixes removed, whitespace collapsed. Used as the
 * unique key in the factors table so "Triumph Financial Services, LLC" and
 * "TRIUMPH FINANCIAL SERVICES LLC" map to the same factor.
 */
export function normalizeEntityName(raw: string | null | undefined): string {
  if (!raw) return ''
  let s = raw.toLowerCase()
  // Drop punctuation to spaces, collapse whitespace.
  s = s.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  // Strip trailing corporate suffixes (possibly several, e.g. "co inc").
  let changed = true
  while (changed) {
    changed = false
    for (const suf of ENTITY_SUFFIXES) {
      if (s === suf) continue
      if (s.endsWith(' ' + suf)) {
        s = s.slice(0, -(suf.length + 1)).trim()
        changed = true
      }
    }
  }
  return s
}

const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
}

const STATE_ABBRS = new Set(Object.values(US_STATES))

/**
 * Best-effort 2-letter state code from a free-text address (e.g. "PO BOX 610028,
 * Dallas, TX 75261" -> "TX"). Prefers the abbreviation immediately before a ZIP,
 * then any standalone state abbreviation or spelled-out state name. Returns null
 * when nothing is recognizable.
 */
export function inferStateFromAddress(addr: string | null | undefined): string | null {
  if (!addr) return null
  const s = addr.trim()
  // "... TX 75261" or "... TX. 75261-1234"
  const zipMatch = s.match(/\b([A-Za-z]{2})\.?\s*,?\s*\d{5}(?:-\d{4})?\b/)
  if (zipMatch && STATE_ABBRS.has(zipMatch[1].toUpperCase())) {
    return zipMatch[1].toUpperCase()
  }
  const lower = s.toLowerCase()
  for (const [name, abbr] of Object.entries(US_STATES)) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) return abbr
  }
  // Any bare 2-letter token that is a known state.
  const tokens = s.toUpperCase().match(/\b[A-Z]{2}\b/g) ?? []
  for (const t of tokens) if (STATE_ABBRS.has(t)) return t
  return null
}
