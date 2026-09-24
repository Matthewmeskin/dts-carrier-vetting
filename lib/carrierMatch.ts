import { parseCarrierAndFactor } from './carrierName'

// Matching TMS load carriers to portal carrier rows. Shared by the haul ingest
// and the tender-exception report so both agree on who a load went to.

/** MC number reduced to digits so "MC-307158" and "307158" compare equal. */
export function normalizeMc(mc: string | null | undefined): string {
  return (mc ?? '').replace(/\D/g, '')
}

/** Carrier name reduced to a comparable key: Brokerware suffixes like "(*)",
 *  "(#)" or "(*A) CA Only" and the "/Factor" tail are dropped, then case and
 *  punctuation are ignored, so "EDI Express, Inc." matches "EDI EXPRESS INC". */
export function nameKey(name: string | null | undefined): string {
  if (!name) return ''
  const base = parseCarrierAndFactor(name).carrierName.replace(/\([^)]*\)/g, ' ')
  return base
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
}

/** Brokerware lists some non-transport accounts as carriers on a load
 *  (cargo-insurance add-ons like Loadsure, placeholder / non-transport
 *  entries). They never haul, so they are neither credited nor policed. */
export function isNonHaulingCarrier(name: string | null | undefined): boolean {
  return /insurance|loadsure|non[- ]?transport|placeholder|warehous/i.test(name ?? '')
}

export interface MatchableCarrier {
  id: string
  dot_number: string
  mc_number: string | null
  brokerware_raw_name: string | null
  legal_name: string | null
  dba_name: string | null
}

/** Index of portal carriers by MC and by name key. */
export class CarrierIndex {
  private byMc = new Map<string, MatchableCarrier[]>()
  private byName = new Map<string, MatchableCarrier[]>()
  constructor(rows: MatchableCarrier[]) {
    const add = (map: Map<string, MatchableCarrier[]>, key: string, c: MatchableCarrier) => {
      if (!key) return
      const list = map.get(key)
      if (!list) map.set(key, [c])
      else if (!list.some((e) => e.id === c.id)) list.push(c)
    }
    for (const r of rows) {
      add(this.byMc, normalizeMc(r.mc_number), r)
      add(this.byName, nameKey(r.brokerware_raw_name), r)
      add(this.byName, nameKey(r.legal_name), r)
      add(this.byName, nameKey(r.dba_name), r)
    }
  }
  /** Portal carriers a TMS load-carrier entry refers to (MC first, else name). */
  match(entry: { carrierMCNumber?: string | null; carrierName?: string | null }): MatchableCarrier[] {
    const mc = normalizeMc(entry.carrierMCNumber)
    if (mc) return this.byMc.get(mc) ?? []
    return this.byName.get(nameKey(entry.carrierName)) ?? []
  }
}
