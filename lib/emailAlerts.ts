import { Resend } from 'resend'

// Where insurance-update requests are sent (Truckstop/RMIS support). Override
// with RMIS_HELP_EMAIL if it ever changes.
const RMIS_HELP_EMAIL = process.env.RMIS_HELP_EMAIL || 'RMISHelp@truckstop.com'

export interface InsuranceRefreshRequest {
  dotNumber: string
  mcNumber?: string | null
  legalName: string
  /** Which coverages are expiring, e.g. ["Auto liability", "Cargo"]. */
  coverages: string[]
  autoExpiration?: string | null
  cargoExpiration?: string | null
  /** A follow-up nudge (coverage now near expiry, still not updated). */
  reminder?: boolean
  /** Whole days until the soonest coverage expires (for reminder wording). */
  daysToExpiration?: number | null
  /** Why we're asking. 'expiring' — coverage is due to expire (the nightly
   *  batch). 'missing' — RMIS shows no current certificate on file at all, so
   *  there is nothing to renew; we need the carrier's certificate pulled in. */
  reason?: 'expiring' | 'missing'
  /** Free-text line from whoever raised the request by hand (e.g. "carrier sent
   *  us their 2026-2027 cargo COI directly"). */
  note?: string | null
}

/**
 * Email RMIS support (Truckstop) to request an updated insurance certificate for
 * a single carrier whose coverage is due to expire. One carrier per email.
 * Returns whether it sent so the caller can log the outcome; never throws.
 */
export async function sendInsuranceRefreshRequest(
  req: InsuranceRefreshRequest
): Promise<{ sent: boolean; to: string; error?: string }> {
  const to = RMIS_HELP_EMAIL
  try {
    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.ALERT_EMAIL_FROM
    if (!apiKey || !from) {
      return { sent: false, to, error: 'Email not configured (RESEND_API_KEY / ALERT_EMAIL_FROM)' }
    }
    const resend = new Resend(apiKey)
    // Route replies to the inbound-capture address when configured (so RMIS
    // replies land in the portal, not a human inbox); otherwise fall back to
    // the DTS compliance inbox.
    const replyTo = (process.env.RMIS_REPLY_TO || process.env.ALERT_EMAIL_TO || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const mc = req.mcNumber ? String(req.mcNumber).replace(/\D/g, '') : ''
    const idLine = `DOT ${req.dotNumber}${mc ? ` · MC ${mc}` : ''}`
    const coverageList = req.coverages.join(' and ')
    const expBits = [
      req.autoExpiration ? `Auto liability expires ${req.autoExpiration}` : '',
      req.cargoExpiration ? `Cargo expires ${req.cargoExpiration}` : '',
    ].filter(Boolean)

    const dLeft =
      typeof req.daysToExpiration === 'number' && req.daysToExpiration >= 0
        ? req.daysToExpiration
        : null
    const missing = req.reason === 'missing'
    const subject = req.reminder
      ? `Reminder — Insurance update request — ${req.legalName} (${idLine})`
      : missing
        ? `Certificate request — ${coverageList} not on file — ${req.legalName} (${idLine})`
        : `Insurance update request — ${req.legalName} (${idLine})`
    const lead = req.reminder
      ? `Following up on our earlier request — this carrier's ${coverageList} coverage ` +
        `is still showing as due to expire${dLeft !== null ? ` and expires in ${dLeft} day(s)` : ''}. ` +
        `Could you please pull the updated certificate?`
      : missing
        ? `Could you please pull the current certificate of insurance for the ` +
          `following carrier? Our RMIS record shows no current ${coverageList} ` +
          `certificate on file for them, so there is nothing for us to verify ` +
          `against. We can't continue using this carrier until it's on file.`
        : `Could you please pull the updated insurance certificate for the following ` +
          `carrier? Their ${coverageList} coverage is showing as due to expire and we'd ` +
          `like the refreshed certificate on file.`
    const noteLine = req.note && req.note.trim()
      ? `<p style="margin:12px 0;">${req.note
          .trim()
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</p>`
      : ''
    const html = `
      <div style="font-family:sans-serif;max-width:640px;line-height:1.5;color:#111;">
        <p>Hello RMIS Support,</p>
        <p>${lead}</p>
        ${noteLine}
        <table style="border-collapse:collapse;margin:12px 0;">
          <tr><td style="padding:2px 12px 2px 0;color:#555;">Carrier</td><td style="font-weight:600;">${req.legalName}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#555;">DOT</td><td>${req.dotNumber}</td></tr>
          ${mc ? `<tr><td style="padding:2px 12px 2px 0;color:#555;">MC</td><td>${mc}</td></tr>` : ''}
          <tr><td style="padding:2px 12px 2px 0;color:#555;">Coverage</td><td>${coverageList}</td></tr>
          ${expBits.length ? `<tr><td style="padding:2px 12px 2px 0;color:#555;vertical-align:top;">Expiration</td><td>${expBits.join('<br/>')}</td></tr>` : ''}
        </table>
        <p>Thank you,<br/>DTS Compliance</p>
      </div>`
    const text =
      `Hello RMIS Support,\n\n${req.reminder ? 'Following up on our earlier request — ' : ''}` +
      (missing
        ? `Please pull the current certificate of insurance for the following carrier ` +
          `(our RMIS record shows no current ${coverageList} certificate on file):\n\n`
        : `Please pull the updated insurance certificate for the following carrier ` +
          `(coverage due to expire${dLeft !== null ? `, expires in ${dLeft} day(s)` : ''}):\n\n`) +
      `Carrier: ${req.legalName}\nDOT: ${req.dotNumber}\n${mc ? `MC: ${mc}\n` : ''}` +
      `Coverage: ${coverageList}\n${expBits.length ? expBits.join('\n') + '\n' : ''}` +
      `${req.note && req.note.trim() ? `\n${req.note.trim()}\n` : ''}` +
      `\nThank you,\nDTS Compliance`

    const { error: sendErr } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      text,
      ...(replyTo.length ? { replyTo } : {}),
    })
    if (sendErr) {
      return { sent: false, to, error: sendErr.message ?? String(sendErr) }
    }
    return { sent: true, to }
  } catch (e) {
    return { sent: false, to, error: e instanceof Error ? e.message : 'send failed' }
  }
}

interface FlaggedCarrier {
  dotNumber: string
  legalName: string
  gapScore?: number
  flaggedCategories?: string[]
  hardStops?: string[]
  flags?: string[]
  approvalLevel?: string
  alertType: 'score_failure' | 'delta_hard_stop' | 'delta_flag'
}

export async function sendComplianceAlert(carriers: FlaggedCarrier[], batchLabel: string) {
  if (carriers.length === 0) return

  const resend = new Resend(process.env.RESEND_API_KEY)
  const FROM = process.env.ALERT_EMAIL_FROM!
  const TO = (process.env.ALERT_EMAIL_TO ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''

  const hardStopCarriers = carriers.filter(c => (c.hardStops?.length ?? 0) > 0)
  const flagCarriers = carriers.filter(c =>
    (c.hardStops?.length ?? 0) === 0 && ((c.flags?.length ?? 0) || (c.flaggedCategories?.length ?? 0)) > 0
  )

  const subject =
    hardStopCarriers.length > 0
      ? `DTS Carrier Compliance — ${hardStopCarriers.length} carrier(s) pending verification`
      : `DTS Carrier Review — ${carriers.length} carrier(s) need attention`

  const hardStopRows = hardStopCarriers.map(c => `
    <tr style="background:#fef2f2;">
      <td style="padding:8px;border:1px solid #e5e7eb;font-weight:600;">${c.legalName}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">DOT ${c.dotNumber}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;color:#dc2626;font-weight:600;">Pending verification</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">${(c.hardStops ?? []).map(neutralIssue).join('<br/>')}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">
        <a href="${APP_URL}/carriers/${c.dotNumber}" style="color:#0063A0;">View Carrier</a>
      </td>
    </tr>`).join('')

  const flagRows = flagCarriers.map(c => `
    <tr>
      <td style="padding:8px;border:1px solid #e5e7eb;">${c.legalName}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">DOT ${c.dotNumber}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;color:#d97706;">
        ${c.gapScore ? `GAP: ${c.gapScore}` : 'Review Required'}
      </td>
      <td style="padding:8px;border:1px solid #e5e7eb;">
        ${[...(c.flaggedCategories ?? []), ...(c.flags ?? [])].join('<br/>')}
      </td>
      <td style="padding:8px;border:1px solid #e5e7eb;">
        <a href="${APP_URL}/carriers/${c.dotNumber}" style="color:#0063A0;">View Carrier</a>
      </td>
    </tr>`).join('')

  const html = `
    <div style="font-family:sans-serif;max-width:900px;margin:0 auto;">
      <div style="background:#AB0534;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h1 style="margin:0;font-size:20px;">DTS Carrier Compliance Alert</h1>
        <p style="margin:4px 0 0;opacity:0.85;font-size:14px;">${batchLabel}</p>
      </div>
      <div style="background:white;padding:24px;border:1px solid #e5e7eb;border-top:none;">
        ${hardStopCarriers.length > 0 ? `
          <h2 style="color:#dc2626;font-size:16px;margin-top:0;">
            Pending Verification (${hardStopCarriers.length})
          </h2>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Not eligible for new loads until the item is verified in the carrier portal.</p>
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Carrier</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">DOT</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Status</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Item</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Action</th>
              </tr>
            </thead>
            <tbody>${hardStopRows}</tbody>
          </table>` : ''}
        ${flagCarriers.length > 0 ? `
          <h2 style="color:#d97706;font-size:16px;">
            Requires Review (${flagCarriers.length})
          </h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Carrier</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">DOT</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Score</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Flags</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Action</th>
              </tr>
            </thead>
            <tbody>${flagRows}</tbody>
          </table>` : ''}
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;">
          <a href="${APP_URL}/carriers"
             style="background:#0063A0;color:white;padding:10px 20px;
                    text-decoration:none;border-radius:6px;font-size:14px;">
            Open Carrier Portal
          </a>
          ${EMAIL_FOOTER}
        </div>
      </div>
    </div>`

  const { error: sendErr } = await resend.emails.send({ from: FROM, to: TO, subject, html })
  if (sendErr) {
    console.error('sendComplianceAlert: Resend rejected the send:', sendErr)
  }
}

// ── Expired-insurance report ─────────────────────────────────────────────────
// A proactive full list of active carriers whose auto/cargo insurance is
// CURRENTLY expired (not just newly-detected). Complements the delta-based daily
// digest, which only surfaces changes.

export interface ExpiredInsuranceCarrier {
  dotNumber: string
  legalName: string
  mcNumber?: string | null
  /** e.g. ["Auto liability expired 7/1/2026", "Cargo status: No-Current-Info"]. */
  issues: string[]
}

export async function sendInsuranceExpiryReport(
  carriers: ExpiredInsuranceCarrier[]
): Promise<{ sent: boolean; error?: string }> {
  try {
    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.ALERT_EMAIL_FROM
    const to = (process.env.ALERT_EMAIL_TO ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!apiKey || !from || to.length === 0) {
      return { sent: false, error: 'Email not configured (RESEND_API_KEY / ALERT_EMAIL_FROM / ALERT_EMAIL_TO)' }
    }
    if (carriers.length === 0) return { sent: true } // nothing expired — no email
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''
    const resend = new Resend(apiKey)
    const esc = (s: string) =>
      String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const link = (dot: string) =>
      APP_URL ? `<a href="${APP_URL}/carriers/${esc(dot)}" style="color:#0063A0;">View</a>` : ''

    const rows = carriers
      .map((c) => {
        const mc = c.mcNumber ? String(c.mcNumber).replace(/\D/g, '') : ''
        return `
      <tr>
        <td style="padding:8px;border:1px solid #e5e7eb;vertical-align:top;">
          <div style="font-weight:600;">${esc(c.legalName)}</div>
          <div style="color:#6b7280;font-size:12px;">DOT ${esc(c.dotNumber)}${mc ? ` · MC ${esc(mc)}` : ''}</div>
        </td>
        <td style="padding:8px;border:1px solid #e5e7eb;vertical-align:top;color:#dc2626;">
          ${c.issues.map((i) => esc(neutralIssue(i))).join('<br/>')}
        </td>
        <td style="padding:8px;border:1px solid #e5e7eb;vertical-align:top;">${link(c.dotNumber)}</td>
      </tr>`
      })
      .join('')

    const subject = `DTS Insurance Verification — ${carriers.length} active carrier${carriers.length === 1 ? '' : 's'} pending a current certificate`
    const html = `
    <div style="font-family:sans-serif;max-width:900px;margin:0 auto;">
      <div style="background:#AB0534;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h1 style="margin:0;font-size:20px;">Insurance Verification Needed</h1>
        <p style="margin:4px 0 0;opacity:0.85;font-size:14px;">${carriers.length} active carrier${carriers.length === 1 ? '' : 's'} where RMIS shows no current certificate — not eligible for new loads until verified.</p>
      </div>
      <div style="background:white;padding:8px 24px 24px;border:1px solid #e5e7eb;border-top:none;">
        <table style="width:100%;border-collapse:collapse;margin-top:12px;">
          <thead><tr style="background:#f9fafb;">
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Carrier</th>
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Coverage on file</th>
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">&nbsp;</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${EMAIL_FOOTER}
      </div>
    </div>`

    const { error: sendErr } = await resend.emails.send({ from, to, subject, html })
    if (sendErr) {
      return { sent: false, error: sendErr.message ?? String(sendErr) }
    }
    return { sent: true }
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : 'send failed' }
  }
}

// Team emails state what the data shows, not conclusions about it: the policy
// wording on the evaluator's findings ("must be Valid", "below the minimum",
// "do not use") stays in the portal, where the reviewer works.
export function neutralIssue(issue: string): string {
  return String(issue)
    .replace(/\s+[—-]\s+(must|do not|hard stop|exception only|requires?|required)\b[\s\S]*$/i, '')
    .replace(/^(.*?)\s+is below the \$[\d,]+ minimum$/i, '$1 on file')
    .replace(/^(Cargo|Auto liability) limit (\$[\d,]+) on file$/i, '$1 limit on file: $2')
    .replace(/^Authority is only (\d+) days old \(under 90 days\)$/i, 'Authority granted $1 days ago')
    .replace(/^Carrier is not active in SAFER — status:/i, 'SAFER status:')
    .replace(/\bhard stop\b/gi, 'compliance item')
    .trim()
}

const EMAIL_FOOTER = `
        <p style="margin:16px 0 0;color:#9ca3af;font-size:11px;line-height:1.5;">
          Internal and confidential. An automated summary of third-party data
          (RMIS, FMCSA, Bluewire) as of the time sent, which may be incomplete or
          out of date. Carrier eligibility is set in the carrier portal; check it
          there before tendering a load. Please don't forward outside DTS.
        </p>`

// ── Daily digest ───────────────────────────────────────────────────────────
// One email per day summarizing everything that needs a human's attention,
// instead of a separate alert per detection. Individual detections still record
// to the carrier's activity log in real time — this just batches the outbound
// notification.

export interface DigestCarrier {
  dotNumber: string
  legalName: string
  mcNumber?: string | null
  hardStops: string[]
  reviews: string[]
}
export interface DigestReply {
  dotNumber: string
  legalName: string
  note: string
}
/** A carrier that is ACTIVE in Brokerware and still has an unresolved hard stop
 *  right now — regardless of when it was first detected. This is the standing
 *  risk list, not a change notification. */
export interface OpenHardStopCarrier {
  dotNumber: string
  legalName: string
  mcNumber?: string | null
  hardStops: string[]
  /** Days since the hard stop was first detected, when known. */
  daysOpen?: number | null
  /** ISO date of the carrier's most recent DTS load, when known. */
  lastHauledAt?: string | null
  /** When the carrier was last set to Exception Approved, when known. */
  exceptionSince?: string | null
  /** Whole days the exception has been open. */
  exceptionDays?: number | null
  /** Extra line under the status column, e.g. why an aged exception was
   *  escalated back into the actionable list. */
  note?: string | null
}
export interface DailyDigestPayload {
  since: string
  until: string
  hardStops: DigestCarrier[]
  /** Every active carrier with an open hard stop TODAY that nobody has signed
   *  off on. Repeats every day until the stop clears, so a carrier that is
   *  still being tendered loads without valid insurance can't quietly age out
   *  of the inbox after its first alert. */
  openHardStops?: OpenHardStopCarrier[]
  /** Open hard stops a reviewer has knowingly accepted (Exception Approved) and
   *  documented. Still listed, because an exception doesn't update the
   *  certificate in RMIS — but kept in its own quieter
   *  section so it doesn't compete with the carriers nobody has looked at. */
  acceptedExceptions?: OpenHardStopCarrier[]
  /** Active carriers whose hard stop(s) fully cleared (insurance restored). The
   *  cleared items are carried in each entry's `hardStops` field. */
  resolved?: DigestCarrier[]
  reviews: DigestCarrier[]
  replies: DigestReply[]
  /** Count of carriers flagged for re-vet by a score upload (summarized, not listed). */
  scoreFlagged?: number
}

/** Build the digest email (subject + HTML). Split out from sending so the
 *  same email can be handed to a different transport: mail from the portal
 *  is sent through Resend, which the DTS tenant currently rejects, while the
 *  n8n Outlook path delivers reliably from the Hamilton mailbox. */
export function renderDailyDigest(
  payload: DailyDigestPayload
): { subject: string; html: string } {
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''

  const esc = (s: string) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const idLine = (c: { dotNumber: string; mcNumber?: string | null }) => {
    const mc = c.mcNumber ? String(c.mcNumber).replace(/\D/g, '') : ''
    return `DOT ${esc(c.dotNumber)}${mc ? ` · MC ${esc(mc)}` : ''}`
  }
  const link = (dot: string) =>
    APP_URL ? `<a href="${APP_URL}/carriers/${esc(dot)}" style="color:#0063A0;">View</a>` : ''


  const hs = payload.hardStops.length
  const rv = payload.reviews.length
  const rp = payload.replies.length
  const sf = payload.scoreFlagged ?? 0
  const rs = payload.resolved?.length ?? 0
  const open = payload.openHardStops ?? []
  const op = open.length
  const accepted = payload.acceptedExceptions ?? []
  const ac = accepted.length
  const dateLabel = new Date(payload.until).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })

  // Counts only — no carrier detail or load activity in the subject line.
  const holds = hs + op
  const subject =
    `DTS Carrier Compliance Digest — ` +
    (holds > 0 ? `${holds} pending verification, ` : '') +
    `${rv} to review${rp ? `, ${rp} RMIS repl${rp === 1 ? 'y' : 'ies'}` : ''} (${dateLabel})`

  // The bulk re-vet queue from a score upload is summarized, not enumerated.
  const scoreFlagSummary =
    sf > 0
      ? `
      <div style="margin:20px 0 0;padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
        <span style="font-weight:600;color:#92400e;">${sf} carrier${sf === 1 ? '' : 's'} flagged for re-vet</span>
        <span style="color:#92400e;"> by the latest Bluewire score upload.</span>
        ${APP_URL ? `<a href="${APP_URL}/carriers" style="color:#0063A0;margin-left:6px;">Review the re-vet queue →</a>` : ''}
      </div>`
      : ''

  const carrierRows = (list: DigestCarrier[], accent: string, issuesOf: (c: DigestCarrier) => string[]) =>
    list
      .map(
        (c) => `
    <tr>
      <td style="padding:8px;border:1px solid #e5e7eb;vertical-align:top;">
        <div style="font-weight:600;">${esc(c.legalName)}</div>
        <div style="color:#6b7280;font-size:12px;">${idLine(c)}</div>
      </td>
      <td style="padding:8px;border:1px solid #e5e7eb;vertical-align:top;color:${accent};">
        ${issuesOf(c).map((i) => esc(neutralIssue(i))).join('<br/>')}
      </td>
      <td style="padding:8px;border:1px solid #e5e7eb;vertical-align:top;">${link(c.dotNumber)}</td>
    </tr>`
      )
      .join('')

  const section = (title: string, color: string, bodyRows: string) =>
    bodyRows
      ? `
      <h2 style="color:${color};font-size:16px;margin:24px 0 8px;">${title}</h2>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Carrier</th>
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Item</th>
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">&nbsp;</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>`
      : ''

  const fmtDate = (iso: string | null | undefined) =>
    iso
      ? new Date(iso).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        })
      : '—'

  // The standing lists show the open item and any reviewer note. How long it
  // has been open and the carrier's load history live in the portal only.
  const rowsFor = (list: OpenHardStopCarrier[], accent: string) =>
    list
      .map(
        (c) => `
    <tr>
      <td style="padding:8px;border:1px solid #e5e7eb;vertical-align:top;">
        <div style="font-weight:600;">${esc(c.legalName)}</div>
        <div style="color:#6b7280;font-size:12px;">${idLine(c)}</div>
      </td>
      <td style="padding:8px;border:1px solid #e5e7eb;vertical-align:top;color:${accent};">
        ${c.hardStops.map((i) => esc(neutralIssue(i))).join('<br/>')}
        ${c.note ? `<div style="color:#6b7280;font-size:12px;margin-top:4px;">${esc(c.note)}</div>` : ''}
      </td>
      <td style="padding:8px;border:1px solid #e5e7eb;vertical-align:top;">${link(c.dotNumber)}</td>
    </tr>`
      )
      .join('')

  const openRows = rowsFor(open, '#dc2626')
  const acceptedRows = rowsFor(accepted, '#b45309')

  const statusTable = (
    title: string,
    color: string,
    blurb: string,
    rows: string
  ) =>
    rows
      ? `
      <h2 style="color:${color};font-size:16px;margin:24px 0 8px;">${title}</h2>
      <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">${blurb}</p>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Carrier</th>
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Item</th>
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">&nbsp;</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`
      : ''

  const openSection = statusTable(
    `Pending Verification (${op})`,
    '#dc2626',
    `Not eligible for new loads until the item is verified in the carrier portal.`,
    openRows
  )

  const acceptedSection = statusTable(
    `Approved Exceptions — Certificate Follow-up (${ac})`,
    '#b45309',
    `Approved by a reviewer with documented reasons. RMIS has not received an ` +
      `updated certificate yet; follow up with the carrier before the re-vet date.`,
    acceptedRows
  )

  const replyRows = payload.replies
    .map(
      (r) => `
    <tr>
      <td style="padding:8px;border:1px solid #e5e7eb;vertical-align:top;">
        <div style="font-weight:600;">${esc(r.legalName)}</div>
        <div style="color:#6b7280;font-size:12px;">DOT ${esc(r.dotNumber)}</div>
      </td>
      <td style="padding:8px;border:1px solid #e5e7eb;vertical-align:top;">${esc(r.note)}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;vertical-align:top;">${link(r.dotNumber)}</td>
    </tr>`
    )
    .join('')

  const html = `
  <div style="font-family:sans-serif;max-width:900px;margin:0 auto;">
    <div style="background:#AB0534;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;font-size:20px;">DTS Carrier Compliance Digest</h1>
      <p style="margin:4px 0 0;opacity:0.85;font-size:14px;">
        ${dateLabel} · ${hs} new${op ? `, ${op} pending verification` : ''}${ac ? `, ${ac} exception follow-up${ac === 1 ? '' : 's'}` : ''}, ${rv} to review${rp ? `, ${rp} RMIS repl${rp === 1 ? 'y' : 'ies'}` : ''}${sf ? ` · ${sf} flagged for re-vet` : ''}
      </p>
    </div>
    <div style="background:white;padding:8px 24px 24px;border:1px solid #e5e7eb;border-top:none;">
        ${section(`New — Pending Verification (${hs})`, '#dc2626', carrierRows(payload.hardStops, '#dc2626', (c) => c.hardStops))}
      ${openSection}
      ${acceptedSection}
      ${section(`Verified — Cleared (${rs})`, '#047857', carrierRows(payload.resolved ?? [], '#047857', (c) => c.hardStops))}
      ${section(`Requires Review (${rv})`, '#d97706', carrierRows(payload.reviews, '#b45309', (c) => c.reviews))}
      ${scoreFlagSummary}
      ${replyRows ? `
        <h2 style="color:#047857;font-size:16px;margin:24px 0 8px;">RMIS Replies (${rp})</h2>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:#f9fafb;">
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Carrier</th>
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Reply</th>
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">&nbsp;</th>
          </tr></thead>
          <tbody>${replyRows}</tbody>
        </table>` : ''}
      ${hs + op + ac + rv + rp + sf + rs === 0 ? `<p style="color:#6b7280;">Nothing new needs attention today.</p>` : ''}
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;">
        <a href="${APP_URL}/carriers"
           style="background:#0063A0;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;font-size:14px;">
          Open Carrier Portal
        </a>
        ${EMAIL_FOOTER}
      </div>
    </div>
  </div>`
  return { subject, html }
}

/**
 * Send the once-a-day digest to the DTS compliance inbox. Returns whether it
 * sent so the caller can record the run; never throws.
 */
export async function sendDailyDigest(
  payload: DailyDigestPayload
): Promise<{ sent: boolean; error?: string; to?: string[]; from?: string }> {
  try {
    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.ALERT_EMAIL_FROM
    const to = (process.env.ALERT_EMAIL_TO ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!apiKey || !from || to.length === 0) {
      return { sent: false, error: 'Email not configured (RESEND_API_KEY / ALERT_EMAIL_FROM / ALERT_EMAIL_TO)' }
    }
    const { subject, html } = renderDailyDigest(payload)
    const resend = new Resend(apiKey)
    const { error: sendErr } = await resend.emails.send({ from, to, subject, html })
    if (sendErr) {
      return { sent: false, to, from, error: sendErr.message ?? String(sendErr) }
    }
    return { sent: true, to, from }
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : 'send failed' }
  }
}
