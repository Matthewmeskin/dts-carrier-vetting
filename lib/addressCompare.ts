// Compare postal addresses the way a person would: case, punctuation, ZIP+4
// and common abbreviations ("North" / "N", "Street" / "St", "P.O. Box" /
// "PO Box") don't make two addresses different.

export interface AddressParts {
  street?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}

const WORDS: Record<string, string> = {
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
  NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW',
  STREET: 'ST', AVENUE: 'AVE', AV: 'AVE', ROAD: 'RD', DRIVE: 'DR', BOULEVARD: 'BLVD',
  LANE: 'LN', COURT: 'CT', CIRCLE: 'CIR', PLACE: 'PL', PARKWAY: 'PKWY',
  HIGHWAY: 'HWY', TERRACE: 'TER', TRAIL: 'TRL', WAY: 'WAY', SUITE: 'STE',
  UNIT: 'STE', APARTMENT: 'APT', BUILDING: 'BLDG', FLOOR: 'FL',
}

function normStreet(s: string | null | undefined): string {
  return String(s ?? '')
    .toUpperCase()
    .replace(/\bP\.?\s*O\.?\s*BOX\b|\bPOST\s+OFFICE\s+BOX\b/g, 'POBOX')
    .replace(/#/g, ' STE ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => WORDS[w] ?? w)
    .join(' ')
}

const norm = (s: string | null | undefined) =>
  String(s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '')

const zip5 = (z: string | null | undefined) => String(z ?? '').replace(/\D/g, '').slice(0, 5)

export function hasAddress(a: AddressParts | null | undefined): boolean {
  return !!String(a?.street ?? '').trim()
}

/** Same place: street and ZIP match, or street and city match when a ZIP is missing. */
export function sameAddress(a: AddressParts | null | undefined, b: AddressParts | null | undefined): boolean {
  if (!hasAddress(a) || !hasAddress(b)) return false
  if (normStreet(a!.street) !== normStreet(b!.street)) return false
  const za = zip5(a!.zip)
  const zb = zip5(b!.zip)
  if (za && zb) return za === zb
  return norm(a!.city) === norm(b!.city)
}

export function isPoBox(a: AddressParts | null | undefined): boolean {
  return /\bP\.?\s*O\.?\s*BOX\b|\bPOST\s+OFFICE\s+BOX\b|\bPMB\b/i.test(String(a?.street ?? ''))
}

export function formatAddress(a: AddressParts | null | undefined): string {
  if (!hasAddress(a)) return ''
  const line2 = [a!.city, [a!.state, a!.zip].filter(Boolean).join(' ')].filter((p) => p && String(p).trim()).join(', ')
  return [a!.street, line2].filter((p) => p && String(p).trim()).join(', ')
}
