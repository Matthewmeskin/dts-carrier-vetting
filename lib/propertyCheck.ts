import { supabaseAdmin } from './supabase'
import { logCarrierEvent } from './auditLog'
import { propertySignals, type PropertyRecord } from './propertySignals'

// County property record for a carrier's FMCSA address, from RentCast
// (owner, property type, sale history). The plan has a small monthly request
// allowance, so a lookup is reused for 30 days unless forced.

const REUSE_DAYS = 30

export const propertyLookupConfigured = () => !!process.env.RENTCAST_API_KEY

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
  }
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
    carrierId: (c.id as string) ?? null,
    names: [c.legal_name, c.dba_name, i.rmis_legal_name, i.rmis_dba_name, i.rmis_contact_name],
    authorityDate: str(i.authority_original_date),
  }
}

export async function runPropertyCheck(
  dot: string,
  opts: { actor: string; force?: boolean }
): Promise<{ check: PropertyCheckRow | null; reused: boolean; error?: string }> {
  const info = await carrierAddress(dot)
  if (!info.address) return { check: null, reused: false, error: 'No physical address on file' }

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
  try {
    ;({ found, raw, record } = await fetchRentcast(info.address))
  } catch (e: any) {
    error = e?.message ?? String(e)
  }

  const { data, error: insErr } = await (supabaseAdmin as any)
    .from('carrier_property_checks')
    .insert([{ dot_number: dot, address: info.address, found, record, raw, error, checked_by: opts.actor }])
    .select('id, dot_number, address, checked_at, found, record, error, checked_by')
    .single()
  if (insErr) throw insErr

  if (!error) {
    const signals = propertySignals(record, { names: info.names, authorityDate: info.authorityDate })
    const top = signals.find((s) => s.level === 'high') ?? signals.find((s) => s.level === 'warn')
    await logCarrierEvent({
      dot,
      carrierId: info.carrierId,
      type: 'property_check',
      summary: found
        ? `Property record: ${record?.propertyType ?? 'type unknown'}, owner ${record?.ownerNames.join(', ') || 'unknown'}` +
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
