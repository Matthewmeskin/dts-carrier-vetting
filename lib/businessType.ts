// W-9 business-type refinement.
//
// The IRS W-9 form lumps individuals, sole proprietors, and single-member LLCs
// onto ONE checkbox, so RMIS reports them as a single combined value. We care
// about the split so AP can confirm the entity type before paying. We can't get
// the split from the W-9 itself, so we INFER it: if the
// carrier's legal name carries an "LLC" suffix we treat it as a single-member
// LLC, otherwise as an individual / sole proprietor. This is a heuristic, always
// labeled as inferred, and never overwrites the stored W-9 value.

// The exact combined value RMIS returns for this W-9 checkbox.
export const COMBINED_INDIVIDUAL_TYPE =
  'Individual/Sole Proprietor or single-member LLC'

export type BusinessCategory =
  | 'single_member_llc'
  | 'individual'
  | 'other'

// Facet keys used by the carrier-list filter (stable strings).
export const BIZ_KEY_SINGLE_MEMBER_LLC = 'single_member_llc'
export const BIZ_KEY_INDIVIDUAL = 'individual_sole_prop'
export const BIZ_KEY_INCORPORATED = 'incorporated_per_name'

/** Does the legal/business name carry an LLC suffix (L.L.C., LLC, etc.)? */
export function hasLlcInName(name: string | null | undefined): boolean {
  const n = String(name ?? '').toLowerCase()
  // Match "llc" or "l.l.c." as a whole token, not inside another word.
  return /\bl\.?\s?l\.?\s?c\.?\b/.test(n)
}

/** Does the name carry an incorporation marker (INC, CORP, LTD, LLP, LP, PC)?
 *  These are businesses, not individuals — regardless of a mis-checked W-9 box. */
export function hasCorpMarkerInName(name: string | null | undefined): boolean {
  const n = String(name ?? '').toLowerCase()
  return /\b(inc|incorporated|corp|corporation|ltd|limited|llp|lp|pc|pllc)\b/.test(
    n
  )
}

/** Digits-only tax id (EIN/SSN); '' when none on file. */
function taxIdDigits(taxId: string | null | undefined): string {
  return String(taxId ?? '').replace(/\D/g, '')
}

export interface RefinedBusinessType {
  /** Stable key for the list-filter facet. */
  key: string
  /** Human label for display. */
  label: string
  /** Coarse category for risk logic. */
  category: BusinessCategory
  /** True when we inferred the split (LLC-in-name) rather than reading it. */
  inferred: boolean
}

/**
 * Refine a stored W-9 company type into a display key/label + category. Only the
 * combined "Individual/Sole Proprietor or single-member LLC" value is split
 * (by LLC-in-name); every other value passes through unchanged.
 */
export function refineBusinessType(
  companyType: string | null | undefined,
  legalName: string | null | undefined
): RefinedBusinessType {
  const raw = String(companyType ?? '').trim()
  if (raw === COMBINED_INDIVIDUAL_TYPE) {
    if (hasLlcInName(legalName)) {
      return {
        key: BIZ_KEY_SINGLE_MEMBER_LLC,
        label: 'Single-member LLC (inferred)',
        category: 'single_member_llc',
        inferred: true,
      }
    }
    // A name that carries INC/CORP/LTD is an incorporated business, even if the
    // W-9 individual box was (mis-)checked — don't call it an individual.
    if (hasCorpMarkerInName(legalName)) {
      return {
        key: BIZ_KEY_INCORPORATED,
        label: 'Incorporated (per name)',
        category: 'other',
        inferred: true,
      }
    }
    return {
      key: BIZ_KEY_INDIVIDUAL,
      label: 'Individual / Sole Proprietor',
      category: 'individual',
      inferred: true,
    }
  }
  return { key: raw, label: raw, category: 'other', inferred: false }
}

export interface BusinessTypeRisk {
  /** Entity-type note (set for individuals / sole proprietors). */
  preferBusiness: string | null
  /** Missing-EIN note (set when we can't confirm the legal entity). */
  missingEin: string | null
}

/**
 * Neutral entity-type notes for AP / onboarding: flags an individual / sole
 * proprietor, and a missing EIN, so staff can confirm the entity type before
 * paying. Purely factual — no stated preference or standard.
 */
export function businessTypeRisk(args: {
  companyType: string | null | undefined
  legalName: string | null | undefined
  /** Full tax id when available (EIN/SSN). */
  w9TaxId?: string | null
  /** Or, when only presence is known (e.g. contexts that keep last-4 only),
   *  pass hasEin directly. Takes precedence over w9TaxId. */
  hasEin?: boolean
}): BusinessTypeRisk {
  const refined = refineBusinessType(args.companyType, args.legalName)
  const einKnown = args.hasEin !== undefined || args.w9TaxId !== undefined
  const hasEin =
    args.hasEin !== undefined
      ? args.hasEin
      : taxIdDigits(args.w9TaxId).length >= 9

  // A sole proprietor is still an individual even with an EIN — an EIN does not
  // make them an LLC/corporation. So we keep the Individual / Sole Proprietor
  // label either way, and only surface the entity note for a sole prop with NO
  // EIN on file (i.e. filing under a bare SSN), which is the case worth a look.
  let preferBusiness: string | null = null
  if (refined.category === 'individual' && einKnown && !hasEin) {
    preferBusiness =
      'W-9 entity type is Individual / Sole Proprietor with no EIN on file (files under an SSN). Confirm the entity type before paying.'
  }

  // For a single-member LLC we lean on the EIN to confirm the entity. Only flag
  // "no EIN" when we actually know the tax id is absent (some list contexts don't
  // carry the tax id and shouldn't false-flag PDF-only W-9s).
  let missingEin: string | null = null
  if (refined.category === 'single_member_llc' && einKnown && !hasEin) {
    missingEin =
      'No EIN on file to confirm the legal entity. Confirm the carrier’s entity type before paying.'
  }

  return { preferBusiness, missingEin }
}
