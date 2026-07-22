// Normalize a carrier / business name for fuzzy matching (e.g. matching a W-9
// filename to a carrier's legal or DBA name). Lowercases, expands "&", strips
// punctuation and common entity suffixes, and collapses whitespace.
const SUFFIXES = new Set([
  'inc',
  'llc',
  'ltd',
  'corp',
  'corporation',
  'co',
  'company',
  'the',
  'incorporated',
  'limited',
])

export function normalizeCarrierName(name: string | null | undefined): string {
  if (!name) return ''
  return String(name)
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !SUFFIXES.has(w))
    .join(' ')
    .trim()
}
