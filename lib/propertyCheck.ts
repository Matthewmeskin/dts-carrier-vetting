import { supabaseAdmin } from './supabase'
import { logCarrierEvent } from './auditLog'
import { isResidential, propertySignals, type PropertyRecord } from './propertySignals'

// County property record for a carrier's FMCSA address: owner, property type
// and sale history. Smarty is tried first because its owner comes from the
// latest recorded deed; RentCast's owner comes from the yearly tax roll and
// can lag a sale by months. RentCast is the fallback when Smarty has no match
// or its subscription has lapsed. Lookups are reused for 30 days unless forced.

const REUSE_DAYS = 30

const smartyConfigured = () => !!(process.env.SMARTY_AUTH_ID && process.env.SMARTY_AUTH_TOKEN)
const rentcastConfigured = () => !!process.env.RENTCAST_API_KEY
export const propertyLookupConfigured = () => smartyConfigured() || rentcastConfigured()

interface AddressParts {
  street: string
  city: string | null
  state: string | null
  zip: string | null
}

const str = (v: unknown) => (v == null ? null : String(v).trim() || null)

export function normalizeRentcast(p: any): PropertyRecord {
  const history = p?.history && typeof p.history === 'object' ? Object.values(p.history) : []
  const sales = (history as any[])
    .filter((h) => /sale/i.test(String(h?.event ?? '')) && h?.date)
    .map((h) => ({ date: String(h.date), price: h.price != null ? Number(h.price) : null }))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  const lastSaleDate = str(p?.lastSaleDate) ?? sales[0]?.date ?? null
  return {
    formattedAddress: str(p?.formattedAddress),
    propertyType: str(p?.propertyType),
    ownerNames: Array.isArray(p?.owner?.names) ? p.owner.names.map(String).filter(Boolean) : [],
    ownerType: str(p?.owner?.type),
    ownerOccupied: typeof p?.ownerOccupied === 'boolean' ? p.ownerOccupied : null,
    ownerMailingAddress: str(p?.owner?.mailingAddress?.formattedAddress),
    lastSaleDate,
    lastSalePrice: p?.lastSalePrice != null ? Number(p.lastSalePrice) : sales[0]?.price ?? null,
    sales,
    yearBuilt: p?.yearBuilt != null ? Number(p.yearBuilt) : null,
    squareFootage: p?.squareFootage != null ? Number(p.squareFootage) : null,
    source: 'rentcast',
    ownerFromDeed: false,
    deedDocumentNumber: null,
  }
}

const titleCase = (v: string) =>
  v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

export function normalizeSmarty(a: any): PropertyRecord {
  const person = (first: unknown, middle: unknown, last: unknown, full: unknown) => {
    const f = str(first)
    const l = str(last)
    return f && l ? [f, str(middle), l].filter(Boolean).join(' ') : str(full)
  }
  const fromDeed = !!str(a?.deed_owner_full_name)
  const ownerNames = (
    fromDeed
      ? [
          person(a.deed_owner_first_name, a.deed_owner_middle_name, a.deed_owner_last_name, a.deed_owner_full_name),
          person(a.deed_owner_first_name2, a.deed_owner_middle_name2, a.deed_owner_last_name2, a.deed_owner_full_name2),
        ]
      : [
          person(a?.first_name, a?.middle_name, a?.last_name, a?.owner_full_name),
          person(a?.first_name_2, a?.middle_name_2, a?.last_name_2, a?.owner_full_name_2),
        ]
  ).filter((n): n is string => !!n)
  const num = (v: unknown) => (str(v) && Number.isFinite(Number(v)) ? Number(v) : null)
  const sales: { date: string; price: number | null }[] = []
  for (const [d, p] of [
    [a?.deed_sale_date, a?.deed_sale_price],
    [a?.sale_date, a?.sale_amount],
    [a?.prior_sale_date, a?.prior_sale_amount],
  ]) {
    const date = str(d)
    if (date && !sales.some((x) => x.date === date)) sales.push({ date, price: num(p) })
  }
  sales.sort((x, y) => Date.parse(y.date) - Date.parse(x.date))
  const flag = String(a?.company_flag ?? '')
  const occ = String(a?.owner_occupancy_status ?? '')
  const mailing = [
    str(a?.contact_full_address),
    [str(a?.contact_city), [str(a?.contact_state), str(a?.contact_zip)].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', '),
  ].filter(Boolean).join(', ')
  return {
    formattedAddress: [str(a?.property_address_full), str(a?.property_address_city), str(a?.property_address_state)]
      .filter(Boolean)
      .join(', ') || null,
    propertyType: str(a?.land_use_standard)
      ? titleCase(String(a.land_use_standard))
      : str(a?.land_use_group)
        ? titleCase(String(a.land_use_group))
        : null,
    ownerNames,
    ownerType: flag ? (/not/.test(flag) ? 'Individual' : 'Organization') : null,
    ownerOccupied: occ ? /^owner_occupied/.test(occ) : null,
    ownerMailingAddress: mailing || null,
    lastSaleDate: str(a?.deed_sale_date) ?? str(a?.sale_date) ?? sales[0]?.date ?? null,
    lastSalePrice: num(a?.deed_sale_price) ?? num(a?.sale_amount) ?? sales[0]?.price ?? null,
    sales,
    yearBuilt: num(a?.year_built),
    squareFootage: num(a?.building_sqft),
    source: 'smarty',
    ownerFromDeed: fromDeed,
    deedDocumentNumber: str(a?.deed_document_number),
  }
}

async function fetchSmarty(parts: AddressParts): Promise<{ found: boolean; raw: any; record: PropertyRecord | null }> {
  const q = new URLSearchParams({
    street: parts.street,
    ...(parts.city ? { city: parts.city } : {}),
    ...(parts.state ? { state: parts.state } : {}),
    ...(parts.zip ? { zipcode: parts.zip } : {}),
    'auth-id': process.env.SMARTY_AUTH_ID ?? '',
    'auth-token': process.env.SMARTY_AUTH_TOKEN ?? '',
  })
  const res = await fetch(`https://us-enrichment.api.smarty.com/lookup/search/property/principal?${q}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (res.status === 404) return { found: false, raw: null, record: null }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = (body as any)?.errors?.[0]?.message || `HTTP ${res.status}`
    throw new Error(`Smarty: ${msg}`)
  }
  const first = Array.isArray(body) ? body[0] : null
  if (!first?.attributes) return { found: false, raw: body, record: null }
  return { found: true, raw: first, record: normalizeSmarty(first.attributes) }
}

async function fetchRentcast(address: string): Promise<{ found: boolean; raw: any; record: PropertyRecord | null }> {
  const key = process.env.RENTCAST_API_KEY
  if (!key) throw new Error('RENTCAST_API_KEY is not set')
  const url = `https://api.rentcast.io/v1/properties?address=${encodeURIComponent(address)}`
  const res = await fetch(url, {
    headers: { 'X-Api-Key': key, Accept: 'application/json' },
    cache: 'no-store',
  })
  if (res.status === 404) return { found: false, raw: null, record: null }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = (body as any)?.message || (body as any)?.error || `HTTP ${res.status}`
    throw new Error(`RentCast: ${msg}`)
  }
  const first = Array.isArray(body) ? body[0] : body
  if (!first) return { found: false, raw: body, record: null }
  return { found: true, raw: first, record: normalizeRentcast(first) }
}

export interface PropertyCheckRow {
  id: string
  dot_number: string
  address: string
  checked_at: string
  found: boolean
  record: PropertyRecord | null
  error: string | null
  checked_by: string | null
}

export async function latestPropertyCheck(dot: string): Promise<PropertyCheckRow | null> {
  const { data } = await (supabaseAdmin as any)
    .from('carrier_property_checks')
    .select('id, dot_number, address, checked_at, found, record, error, checked_by')
    .eq('dot_number', dot)
    .order('checked_at', { ascending: false })
    .limit(1)
  return (data?.[0] as PropertyCheckRow) ?? null
}

/** The carrier's FMCSA physical address (RMIS), falling back to the TMS one. */
async function carrierAddress(dot: string) {
  const [{ data: ins }, { data: car }] = await Promise.all([
    (supabaseAdmin as any)
      .from('latest_carrier_insurance')
      .select('rmis_carrier_street, rmis_carrier_city, rmis_carrier_state, rmis_carrier_zip, rmis_legal_name, rmis_dba_name, rmis_contact_name, authority_original_date')
      .eq('dot_number', dot)
      .maybeSingle(),
    (supabaseAdmin as any)
      .from('carriers')
      .select('id, legal_name, dba_name, street, city, state, zip')
      .eq('dot_number', dot)
      .maybeSingle(),
  ])
  const i = (ins as any) ?? {}
  const c = (car as any) ?? {}
  const parts = i.rmis_carrier_street
    ? [i.rmis_carrier_street, i.rmis_carrier_city, i.rmis_carrier_state, i.rmis_carrier_zip]
    : [c.street, c.city, c.state, c.zip]
  const [street, city, state, zip] = parts.map((p: any) => str(p))
  const address = street && (zip || (city && state))
    ? `${street}, ${[city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}`
    : null
  return {
    address,
    parts: street ? ({ street, city, state, zip: zip ? zip.slice(0, 5) : null } as AddressParts) : null,
    carrierId: (c.id as string) ?? null,
    names: [c.legal_name, c.dba_name, i.rmis_legal_name, i.rmis_dba_name, i.rmis_contact_name],
    authorityDate: str(i.authority_original_date),
  }
}

export async function runPropertyCheck(
  dot: string,
  opts: {
    actor: string
    force?: boolean
    /** Bulk sweeps: skip the activity-log entry for a non-residential
     *  address with nothing to flag. */
    quietUnlessResidential?: boolean
  }
): Promise<{ check: PropertyCheckRow | null; reused: boolean; error?: string }> {
  const info = await carrierAddress(dot)
  if (!info.address || !info.parts) return { check: null, reused: false, error: 'No physical address on file' }

  const prev = await latestPropertyCheck(dot)
  if (
    !opts.force &&
    prev &&
    !prev.error &&
    prev.address === info.address &&
    Date.now() - Date.parse(prev.checked_at) < REUSE_DAYS * 86400e3
  ) {
    return { check: prev, reused: true }
  }

  let found = false
  let raw: any = null
  let record: PropertyRecord | null = null
  let error: string | null = null
  // Smarty first (deed owner); RentCast when Smarty has no match or fails.
  const errors: string[] = []
  if (smartyConfigured()) {
    try {
      ;({ found, raw, record } = await fetchSmarty(info.parts))
    } catch (e: any) {
      errors.push(e?.message ?? String(e))
    }
  }
  if (!found && rentcastConfigured()) {
    try {
      ;({ found, raw, record } = await fetchRentcast(info.address))
    } catch (e: any) {
      errors.push(e?.message ?? String(e))
    }
  }
  if (!found && errors.length) error = errors.join('; ')

  const { data, error: insErr } = await (supabaseAdmin as any)
    .from('carrier_property_checks')
    .insert([{ dot_number: dot, address: info.address, found, record, raw, error, checked_by: opts.actor }])
    .select('id, dot_number, address, checked_at, found, record, error, checked_by')
    .single()
  if (insErr) throw insErr

  const signals = propertySignals(record, { names: info.names, authorityDate: info.authorityDate })
  const quiet =
    opts.quietUnlessResidential &&
    !isResidential(record) &&
    !signals.some((x) => x.level !== 'info')
  if (!error && !quiet) {
    const top = signals.find((s) => s.level === 'high') ?? signals.find((s) => s.level === 'warn')
    await logCarrierEvent({
      dot,
      carrierId: info.carrierId,
      type: 'property_check',
      summary: found
        ? `Property record: ${record?.propertyType ?? 'type unknown'}, ${record?.ownerFromDeed ? 'deed owner' : 'owner'} ${record?.ownerNames.join(', ') || 'unknown'}` +
          `${record?.lastSaleDate ? `, last sold ${record.lastSaleDate.slice(0, 10)}` : ''}.` +
          (top ? ` ${top.text}` : '')
        : `No county property record found for ${info.address}.`,
      detail: { address: info.address, found, record, signals },
      actor: opts.actor,
    })
  }
  return { check: data as PropertyCheckRow, reused: false, error: error ?? undefined }
}

/** Signals for the latest stored check, for the onboarding decision. */
export async function propertySignalsFor(dot: string) {
  const [check, info] = await Promise.all([latestPropertyCheck(dot), carrierAddress(dot)])
  if (!check?.found || !check.record) return []
  return propertySignals(check.record, { names: info.names, authorityDate: info.authorityDate })
}
