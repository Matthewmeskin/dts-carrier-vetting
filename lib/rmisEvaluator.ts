import { ParsedRMISData } from './rmisParser'
import { normalizeEntityName } from './sosNormalize'
import { differenceInDays, parseISO, isValid } from 'date-fns'

// Words that carry no identity signal when comparing a W-9 name to the FMCSA
// legal name (corporate suffixes are already stripped by normalizeEntityName).
const NAME_STOPWORDS = new Set(['and', 'the', 'of', 'a', 'dba'])

/**
 * Whether a W-9 business name plausibly refers to the same entity as the FMCSA
 * legal name. Both are normalized (lowercased, punctuation/suffixes stripped) so
 * "Tonys Transport & Service" and "TONY'S TRANSPORT AND SERVICE INC." match.
 * Considered a match when one normalized name contains the other, or they share
 * at least half of the shorter name's significant tokens.
 */
function w9NamePlausiblyMatches(w9Name: string, legalName: string): boolean {
  const a = normalizeEntityName(legalName)
  const b = normalizeEntityName(w9Name)
  if (!a || !b) return true // nothing meaningful to compare — don't flag
  if (a.includes(b) || b.includes(a)) return true
  const toks = (s: string) => {
    const out: string[] = []
    for (const t of s.split(' ')) {
      if (t && !NAME_STOPWORDS.has(t) && !out.includes(t)) out.push(t)
    }
    return out
  }
  const at = toks(a)
  const bt = toks(b)
  if (at.length === 0 || bt.length === 0) return true
  const shared = at.filter((t) => bt.includes(t)).length
  return shared / Math.min(at.length, bt.length) >= 0.5
}

export interface RMISEvaluation {
  hardStops: string[]
  flags: string[]
  info: string[]
  overallPass: boolean
  approvalNotes: string
}

const AUTO_LIABILITY_MINIMUM = 1_000_000
const CARGO_MINIMUM = 100_000
const AUTHORITY_MINIMUM_DAYS = 365
const AUTHORITY_NEW_CARRIER_DAYS = 90
// Coverage within this many days of its expiration date is flagged for renewal
// (not a hard stop) so we can chase new certificates before it actually lapses.
const COVERAGE_EXPIRING_SOON_DAYS = 30

/** Whole days from today until an ISO/RMIS date, or null if unparseable. */
function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const d = parseISO(dateStr)
  if (!isValid(d)) return null
  return differenceInDays(d, new Date())
}

export function evaluateRMIS(data: ParsedRMISData): RMISEvaluation {
  const hardStops: string[] = []
  const flags: string[] = []
  const info: string[] = []

  // HARD STOP — Active operating authority (Policy Section 5). A carrier may
  // operate under COMMON or CONTRACT authority (or both); either being active
  // satisfies the requirement. Only hard-stop when neither is active.
  const commonActive = data.commonAuthorityStatus === 'A'
  const contractActive = data.contractAuthorityStatus === 'A'
  if (!commonActive && !contractActive) {
    hardStops.push(
      `No active operating authority — FMCSA shows common "${data.commonAuthorityStatus || 'unknown'}", ` +
      `contract "${data.contractAuthorityStatus || 'unknown'}"`
    )
  }

  if (data.saferActiveStatus !== 'ACTIVE') {
    hardStops.push(
      `Carrier is not active in SAFER — status: "${data.saferActiveStatus}"`
    )
  }

  // HARD STOP — Safety rating (Policy Section 5 + 9)
  if (['Unsatisfactory', 'Conditional'].includes(data.safetyRating)) {
    hardStops.push(
      `Safety rating is ${data.safetyRating} — hard stop, do not use, requires owner + legal review`
    )
  }

  // HARD STOP — Auto liability insurance (Policy Section 5 + 8). Coverage that is
  // still valid but nearing its expiration date is a renewal FLAG, not a hard
  // stop — it only becomes a hard stop once the policy has actually expired.
  const autoDaysLeft = daysUntil(data.autoExpirationDate)
  if (data.autoStatus !== 'Valid') {
    hardStops.push(
      `Auto liability coverage status is "${data.autoStatus}" — must be Valid`
    )
  } else if (autoDaysLeft !== null && autoDaysLeft < 0) {
    hardStops.push(
      `Auto liability coverage expired ${Math.abs(autoDaysLeft)} day(s) ago ` +
      `(${data.autoExpirationDate}) — must be renewed`
    )
  } else if (data.autoLimit < AUTO_LIABILITY_MINIMUM) {
    hardStops.push(
      `Auto liability limit $${data.autoLimit.toLocaleString()} is below the $1,000,000 minimum`
    )
  } else if (autoDaysLeft !== null && autoDaysLeft <= COVERAGE_EXPIRING_SOON_DAYS) {
    flags.push(
      `Auto liability coverage expires in ${autoDaysLeft} day(s) ` +
      `(${data.autoExpirationDate}) — request an updated certificate before it lapses`
    )
  }

  // HARD STOP — Cargo coverage (Policy Section 5 + 8). Same treatment: expiring
  // soon is a renewal flag; only an actually-expired policy is a hard stop.
  const cargoDaysLeft = daysUntil(data.cargoExpirationDate)
  if (data.cargoStatus !== 'Valid') {
    hardStops.push(
      `Cargo coverage status is "${data.cargoStatus}" — must be Valid`
    )
  } else if (cargoDaysLeft !== null && cargoDaysLeft < 0) {
    hardStops.push(
      `Cargo coverage expired ${Math.abs(cargoDaysLeft)} day(s) ago ` +
      `(${data.cargoExpirationDate}) — must be renewed`
    )
  } else if (data.cargoLimit < CARGO_MINIMUM) {
    hardStops.push(
      `Cargo limit $${data.cargoLimit.toLocaleString()} is below the $100,000 minimum`
    )
  } else if (cargoDaysLeft !== null && cargoDaysLeft <= COVERAGE_EXPIRING_SOON_DAYS) {
    flags.push(
      `Cargo coverage expires in ${cargoDaysLeft} day(s) ` +
      `(${data.cargoExpirationDate}) — request an updated certificate before it lapses`
    )
  }

  // HARD STOP — Authority age (Policy Section 7, <90 days)
  const authorityDate = data.authorityOriginalDate
    ? parseISO(data.authorityOriginalDate)
    : null
  const authorityDays = authorityDate && isValid(authorityDate)
    ? differenceInDays(new Date(), authorityDate)
    : null

  if (authorityDays !== null && authorityDays < AUTHORITY_NEW_CARRIER_DAYS) {
    hardStops.push(
      `Authority is only ${authorityDays} days old (under 90 days) — ` +
      `requires senior approval, direct insurance verification, pickup verification, ` +
      `live tracking, and one-load limitation`
    )
  }

  // FLAG — Authority under 365 days but over 90 (Policy Section 7)
  if (
    authorityDays !== null &&
    authorityDays >= AUTHORITY_NEW_CARRIER_DAYS &&
    authorityDays < AUTHORITY_MINIMUM_DAYS
  ) {
    flags.push(
      `Authority is ${authorityDays} days old — under 365-day minimum. ` +
      `Requires documented exception with ownership review, prior experience verification, ` +
      `and operational controls`
    )
  }

  // FLAG — Prior authority revocation on record (Policy Section 7)
  if (data.authorityRevocationDate) {
    flags.push(
      `Prior authority revocation on record: ${data.authorityRevocationDate}. ` +
      `Review authority history before use`
    )
  }

  // FLAG — General liability expired or missing (Policy Section 6)
  if (
    data.generalStatus === 'No-Current-Info' ||
    data.generalStatus === 'Empty' ||
    data.generalStatus === ''
  ) {
    flags.push(
      `General liability has no current info in RMIS — ` +
      `$1M per occurrence and $2M aggregate is preferred (not required)`
    )
  }

  // FLAG — Broker-carrier agreement (Policy Section 6)
  if (!data.brokerCarrierAgreementOnFile) {
    flags.push(
      `No executed broker-carrier agreement found in RMIS — ` +
      `agreement must be on file before use`
    )
  }

  // FLAG — W9 missing (Policy Section 6)
  if (!data.w9OnFile) {
    flags.push(`W-9 not on file in RMIS — required before payment`)
  }

  // FLAG — W9 identity mismatch check (Policy Section 11). Normalized comparison
  // so punctuation/formatting differences ("&" vs "and", apostrophes, "Inc")
  // don't misfire — only a genuine name divergence is flagged.
  if (
    data.w9OnFile &&
    data.w9BusinessName &&
    data.legalName &&
    !w9NamePlausiblyMatches(data.w9BusinessName, data.legalName)
  ) {
    flags.push(
      `W-9 business name "${data.w9BusinessName}" may not match FMCSA legal name ` +
      `"${data.legalName}" — verify identity consistency`
    )
  }

  // FLAG — Factoring: pay-to entity mismatch (Policy Section 11 + 17)
  if (data.isFactoring && data.payToEntity) {
    flags.push(
      `Carrier is factoring — payments go to ${data.payToEntity}. ` +
      `Verify Notice of Assignment (NOA) is on file and pay-to address is correct`
    )
  }

  // FLAG — Zero inspections (Policy Section 10)
  if (data.usTotalInspections === 0) {
    flags.push(
      `Zero roadside inspections on record — elevated risk signal. ` +
      `Does not automatically disqualify but requires exception review, ` +
      `direct conversation with carrier owner, and enhanced operational controls`
    )
  }

  // Out-of-service performance is intentionally NOT surfaced here — it is
  // already captured by the Bluewire safety scores (Driver OOS Score, CSA
  // basics, etc.), which are the system of record for safety. Showing RMIS OOS
  // ratios too would double-count the same signal.

  // INFO — Crash history (Policy Section 15). Crash severity is already captured
  // by the Bluewire safety scores, so RMIS reports crash counts as informational
  // only — never as a flag.
  if (data.usTotalCrashes > 0 || data.usFatalCrashes > 0) {
    info.push(
      `${data.usTotalCrashes} total crash(es) on record (${data.usTowCrashes} tow, ` +
      `${data.usInjuryCrashes} injury, ${data.usFatalCrashes} fatal)`
    )
  } else {
    info.push('No crash history on record')
  }

  // INFO — RMIS certification notes (surface any notes RMIS itself flagged).
  // Workers' comp / employers-liability is not required for carriers, so its
  // absence is never a flag (kept as info only).
  for (const note of data.certificationNotes) {
    const lower = note.toLowerCase()
    const isWorkersComp =
      lower.includes('workerscomp') ||
      lower.includes('workers comp') ||
      lower.includes('empliability') ||
      lower.includes('employers liability') ||
      lower.includes("employer's liability")
    if (isWorkersComp) {
      info.push(`RMIS note: ${note}`)
    } else if (lower.includes('expired') || lower.includes('no active')) {
      flags.push(`RMIS certification note: ${note}`)
    } else {
      info.push(`RMIS note: ${note}`)
    }
  }

  // INFO — Insurance confidence level
  if (data.autoConfidence && data.autoConfidence !== 'High') {
    flags.push(
      `Auto liability confidence level is "${data.autoConfidence}" — not High. ` +
      `RMIS may not have direct confirmation from insurer`
    )
  }
  if (data.cargoConfidence && data.cargoConfidence !== 'High') {
    flags.push(
      `Cargo confidence level is "${data.cargoConfidence}" — not High`
    )
  }

  const overallPass = hardStops.length === 0

  const approvalNotes = overallPass
    ? flags.length === 0
      ? 'Clears RMIS policy check — no hard stops or flags'
      : `Clears RMIS hard stop check but has ${flags.length} flag(s) requiring review`
    : `DOES NOT CLEAR — ${hardStops.length} hard stop(s) must be resolved before use`

  return { hardStops, flags, info, overallPass, approvalNotes }
}
