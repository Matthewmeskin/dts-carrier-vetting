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

// ZIP3 (first three digits) → state, by USPS prefix ranges. Deterministic and
// covers the whole 50 states + DC + PR, used to recover a carrier's state from
// its RMIS ZIP when an explicit state isn't present.
const ZIP3_RANGES: { lo: number; hi: number; st: string }[] = [
  { lo: 6, hi: 9, st: 'PR' },
  { lo: 5, hi: 5, st: 'NY' },
  { lo: 10, hi: 27, st: 'MA' },
  { lo: 28, hi: 29, st: 'RI' },
  { lo: 30, hi: 38, st: 'NH' },
  { lo: 39, hi: 49, st: 'ME' },
  { lo: 50, hi: 59, st: 'VT' },
  { lo: 60, hi: 69, st: 'CT' },
  { lo: 70, hi: 89, st: 'NJ' },
  { lo: 100, hi: 149, st: 'NY' },
  { lo: 150, hi: 196, st: 'PA' },
  { lo: 197, hi: 199, st: 'DE' },
  { lo: 200, hi: 205, st: 'DC' },
  { lo: 206, hi: 219, st: 'MD' },
  { lo: 220, hi: 246, st: 'VA' },
  { lo: 247, hi: 268, st: 'WV' },
  { lo: 270, hi: 289, st: 'NC' },
  { lo: 290, hi: 299, st: 'SC' },
  { lo: 300, hi: 319, st: 'GA' },
  { lo: 320, hi: 349, st: 'FL' },
  { lo: 350, hi: 369, st: 'AL' },
  { lo: 370, hi: 385, st: 'TN' },
  { lo: 386, hi: 397, st: 'MS' },
  { lo: 398, hi: 399, st: 'GA' },
  { lo: 400, hi: 427, st: 'KY' },
  { lo: 430, hi: 459, st: 'OH' },
  { lo: 460, hi: 479, st: 'IN' },
  { lo: 480, hi: 499, st: 'MI' },
  { lo: 500, hi: 528, st: 'IA' },
  { lo: 530, hi: 549, st: 'WI' },
  { lo: 550, hi: 567, st: 'MN' },
  { lo: 570, hi: 577, st: 'SD' },
  { lo: 580, hi: 588, st: 'ND' },
  { lo: 590, hi: 599, st: 'MT' },
  { lo: 600, hi: 629, st: 'IL' },
  { lo: 630, hi: 658, st: 'MO' },
  { lo: 660, hi: 679, st: 'KS' },
  { lo: 680, hi: 693, st: 'NE' },
  { lo: 700, hi: 714, st: 'LA' },
  { lo: 716, hi: 729, st: 'AR' },
  { lo: 730, hi: 749, st: 'OK' },
  { lo: 750, hi: 799, st: 'TX' },
  { lo: 800, hi: 816, st: 'CO' },
  { lo: 820, hi: 831, st: 'WY' },
  { lo: 832, hi: 838, st: 'ID' },
  { lo: 840, hi: 847, st: 'UT' },
  { lo: 850, hi: 865, st: 'AZ' },
  { lo: 870, hi: 884, st: 'NM' },
  { lo: 885, hi: 885, st: 'TX' },
  { lo: 889, hi: 898, st: 'NV' },
  { lo: 900, hi: 961, st: 'CA' },
  { lo: 967, hi: 968, st: 'HI' },
  { lo: 970, hi: 979, st: 'OR' },
  { lo: 980, hi: 994, st: 'WA' },
  { lo: 995, hi: 999, st: 'AK' },
]

/** Best-effort 2-letter state from a US ZIP code (uses the ZIP3 prefix). */
export function stateFromZip(zip: string | null | undefined): string | null {
  if (!zip) return null
  const m = /(\d{5})/.exec(String(zip))
  if (!m) return null
  const z3 = parseInt(m[1].slice(0, 3), 10)
  for (const r of ZIP3_RANGES) if (z3 >= r.lo && z3 <= r.hi) return r.st
  return null
}

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
