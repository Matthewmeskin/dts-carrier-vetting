// Canned note templates for carrier status changes, shared by the bulk table
// action and the per-carrier vetting workspace so the wording stays consistent
// and legally neutral.

/** Neutral "inactive carrier" hold note. Deliberately administrative in tone —
 *  it records WHY without any adverse determination, since a held carrier may be
 *  reactivated and re-vetted later. */
export const INACTIVE_CARRIER_HOLD_NOTE =
  'Carrier placed on hold — inactive. Not currently used for DTS shipments (no ' +
  'recent loads / activity). Administrative hold only, not an adverse ' +
  'determination; may be reactivated and re-vetted before future use.'
