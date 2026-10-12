// What the county property record for a carrier's FMCSA address says about the
// carrier. Pure, so the carrier page and the onboarding decision read it the
// same way.

export interface PropertyRecord {
  formattedAddress: string | null
  propertyType: string | null
  ownerNames: string[]
  ownerType: string | null
  ownerOccupied: boolean | null
  ownerMailingAddress: string | null
  lastSaleDate: string | null
  lastSalePrice: number | null
  sales: { date: string; price: number | null }[]
  yearBuilt: number | null
  squareFootage: number | null
  /** Where the record came from. */
  source?: 'smarty' | 'rentcast'
  /** True when the owner names come from the latest recorded deed (current
   *  within weeks), false when they come from the yearly tax roll. */
  ownerFromDeed?: boolean
  deedDocumentNumber?: string | null
}

export interface PropertySignal {
  level: 'high' | 'warn' | 'info'
  text: string
}

const RESIDENTIAL = /residential|residence|single family|condo|townhouse|manufactured|multi.?family|apartment|mobile/i

const STOP = new Set([
  'LLC', 'INC', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LP', 'THE', 'AND',
  'TRUCKING', 'TRUCK', 'TRUCKS', 'TRANSPORT', 'TRANSPORTATION', 'LOGISTICS',
  'FREIGHT', 'EXPRESS', 'CARRIER', 'CARRIERS', 'LINES', 'SERVICES', 'SERVICE',
  'GROUP', 'ENTERPRISES', 'TRUST', 'FAMILY', 'LIVING', 'REVOCABLE', 'ESTATE',
])
const tokens = (s: string | null | undefined) =>
  String(s ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t))

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })

export function isResidential(r: PropertyRecord | null | undefined): boolean {
  return !!r?.propertyType && RESIDENTIAL.test(r.propertyType)
}

/** Does any owner of record share a name with the carrier or its contact? */
export function ownerMatchesCarrier(
  r: PropertyRecord,
  names: (string | null | undefined)[]
): boolean | null {
  if (!r.ownerNames.length) return null
  const carrier = new Set(names.flatMap(tokens))
  if (carrier.size === 0) return null
  return r.ownerNames.some((o) => tokens(o).some((t) => carrier.has(t)))
}

export function propertySignals(
  r: PropertyRecord | null | undefined,
  ctx: {
    /** Carrier legal / DBA name and RMIS contact. */
    names: (string | null | undefined)[]
    /** When the carrier's operating authority was granted. */
    authorityDate?: string | null
    now?: number
  }
): PropertySignal[] {
  if (!r) return []
  const out: PropertySignal[] = []
  const now = ctx.now ?? Date.now()
  const residential = isResidential(r)
  const match = ownerMatchesCarrier(r, ctx.names)
  const saleMs = r.lastSaleDate ? Date.parse(r.lastSaleDate) : NaN
  const authMs = ctx.authorityDate ? Date.parse(ctx.authorityDate) : NaN

  if (Number.isFinite(saleMs)) {
    const daysAgo = Math.floor((now - saleMs) / 86400e3)
    const recent = daysAgo >= 0 && daysAgo <= 365
    if (match === true) {
      // Tax-roll owner names often lag a sale by months, so a recent sale with
      // the carrier's name still on the record can't tell us whether the
      // carrier bought the house or sold it and moved. A deed-sourced owner
      // is current, so a match there means the carrier bought it.
      if (recent && !r.ownerFromDeed) {
        out.push({
          level: 'warn',
          text:
            `Address sold ${fmt(r.lastSaleDate!)} (${daysAgo} days ago). The owner on record ` +
            `(${r.ownerNames.join(', ')}) matches the carrier, but owner records can lag a sale. ` +
            `Confirm the carrier bought it rather than sold it and moved.`,
        })
      }
    } else if (Number.isFinite(authMs) && saleMs > authMs && daysAgo <= 730) {
      // A sale in the last two years to someone other than the carrier is the
      // abandoned-address pattern (the carrier moved out, FMCSA never updated).
      out.push({
        level: 'high',
        text:
          `Address sold ${fmt(r.lastSaleDate!)}, after the carrier's authority was granted ` +
          `(${fmt(ctx.authorityDate!)}). The carrier may no longer be at its FMCSA address.`,
      })
    } else if (Number.isFinite(authMs) && saleMs > authMs && match === false) {
      // Older sale: more often the carrier rents, or the house is in a
      // relative's or holding company's name, than an abandoned address.
      out.push({
        level: 'warn',
        text:
          `Address last sold ${fmt(r.lastSaleDate!)} to ${r.ownerNames.join(', ')}, after the carrier's ` +
          `authority was granted. Confirm the carrier rents or operates here.`,
      })
    } else if (recent) {
      out.push({
        level: 'warn',
        text: `Address sold ${fmt(r.lastSaleDate!)} (${daysAgo} days ago). Confirm the carrier still operates here.`,
      })
    }
  }

  if (match === false && !out.some((o) => o.text.includes(r.ownerNames.join(', ')))) {
    out.push({
      level: residential ? 'warn' : 'info',
      text: `Owner of record (${r.ownerNames.join(', ')}) doesn't match the carrier name or contact.`,
    })
  }

  if (residential) {
    out.push({
      level: 'info',
      text: `Residential property (${r.propertyType}). Common for owner operators; confirm where trucks are kept.`,
    })
  }
  return out
}
