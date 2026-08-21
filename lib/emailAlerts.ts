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
    const subject = req.reminder
      ? `Reminder — Insurance update request — ${req.legalName} (${idLine})`
      : `Insurance update request — ${req.legalName} (${idLine})`
    const lead = req.reminder
      ? `Following up on our earlier request — this carrier's ${coverageList} coverage ` +
        `is still showing as due to expire${dLeft !== null ? ` and expires in ${dLeft} day(s)` : ''}. ` +
        `Could you please pull the updated certificate?`
      : `Could you please pull the updated insurance certificate for the following ` +
        `carrier? Their ${coverageList} coverage is showing as due to expire and we'd ` +
        `like the refreshed certificate on file.`
    const html = `
      <div style="font-family:sans-serif;max-width:640px;line-height:1.5;color:#111;">
        <p>Hello RMIS Support,</p>
        <p>${lead}</p>
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
      `Please pull the updated insurance certificate for the following carrier ` +
      `(coverage due to expire${dLeft !== null ? `, expires in ${dLeft} day(s)` : ''}):\n\n` +
      `Carrier: ${req.legalName}\nDOT: ${req.dotNumber}\n${mc ? `MC: ${mc}\n` : ''}` +
      `Coverage: ${coverageList}\n${expBits.length ? expBits.join('\n') + '\n' : ''}` +
      `\nThank you,\nDTS Compliance`

    await resend.emails.send({
      from,
      to,
      subject,
      html,
      text,
      ...(replyTo.length ? { replyTo } : {}),
    })
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
      ? `⚠️ DTS Carrier Alert — ${hardStopCarriers.length} hard stop(s) require immediate action`
      : `DTS Carrier Review — ${carriers.length} carrier(s) need attention`

  const hardStopRows = hardStopCarriers.map(c => `
    <tr style="background:#fef2f2;">
      <td style="padding:8px;border:1px solid #e5e7eb;font-weight:600;">${c.legalName}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">DOT ${c.dotNumber}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;color:#dc2626;font-weight:600;">HARD STOP</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">${(c.hardStops ?? []).join('<br/>')}</td>
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
            Hard Stops — Do Not Use Until Resolved (${hardStopCarriers.length})
          </h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Carrier</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">DOT</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Status</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Issue</th>
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
        </div>
      </div>
    </div>`

  await resend.emails.send({ from: FROM, to: TO, subject, html })
}

// ── Hard-stop resolved ───────────────────────────────────────────────────────
// The good-news counterpart to sendComplianceAlert: a carrier that previously
// had a hard stop (typically expired/missing insurance) now clears it after a
// fresh RMIS pull (e.g. the updated COI came in). Notifies the compliance inbox
// so the carrier can be put back into rotation.

export interface ResolvedHardStopCarrier {
  dotNumber: string
  legalName: string
  mcNumber?: string | null
  /** The hard stop(s) that cleared since the previous pull. */
  resolved: string[]
  nowCertified?: boolean | null
  autoStatus?: string | null
  cargoStatus?: string | null
}

export async function sendHardStopResolved(
  carriers: ResolvedHardStopCarrier[]
): Promise<{ sent: boolean; error?: string }> {
  try {
    if (carriers.length === 0) return { sent: true }
    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.ALERT_EMAIL_FROM
    const to = (process.env.ALERT_EMAIL_TO ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!apiKey || !from || to.length === 0) {
      return { sent: false, error: 'Email not configured (RESEND_API_KEY / ALERT_EMAIL_FROM / ALERT_EMAIL_TO)' }
    }
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''
    const resend = new Resend(apiKey)
    const esc = (s: string) =>
      String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const link = (dot: string) =>
      APP_URL ? `<a href="${APP_URL}/carriers/${esc(dot)}" style="color:#0063A0;">View</a>` : ''

    const rows = carriers
      .map((c) => {
        const mc = c.mcNumber ? String(c.mcNumber).replace(/\D/g, '') : ''
        const cov = [
          c.autoStatus ? `Auto: ${esc(c.autoStatus)}` : '',
          c.cargoStatus ? `Cargo: ${esc(c.cargoStatus)}` : '',
        ]
          .filter(Boolean)
          .join(' · ')
        return `
      <tr>
        <td style="padding:8px;border:1px solid #e5e7eb;vertical-align:top;">
          <div style="font-weight:600;">${esc(c.legalName)}</div>
          <div style="color:#6b7280;font-size:12px;">DOT ${esc(c.dotNumber)}${mc ? ` · MC ${esc(mc)}` : ''}</div>
        </td>
        <td style="padding:8px;border:1px solid #e5e7eb;vertical-align:top;color:#047857;">
          Cleared: ${c.resolved.map((i) => esc(i)).join('<br/>')}
          ${c.nowCertified ? '<br/><span style="font-weight:600;">Now RMIS certified</span>' : ''}
          ${cov ? `<br/><span style="color:#6b7280;">${cov}</span>` : ''}
        </td>
        <td style="padding:8px;border:1px solid #e5e7eb;vertical-align:top;">${link(c.dotNumber)}</td>
      </tr>`
      })
      .join('')

    const n = carriers.length
    const subject = `✅ DTS — ${n} carrier hard stop${n === 1 ? '' : 's'} resolved (insurance restored)`
    const html = `
    <div style="font-family:sans-serif;max-width:900px;margin:0 auto;">
      <div style="background:#047857;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h1 style="margin:0;font-size:20px;">Hard Stop Resolved</h1>
        <p style="margin:4px 0 0;opacity:0.9;font-size:14px;">${n} carrier${n === 1 ? '' : 's'} cleared a prior hard stop after a fresh RMIS pull.</p>
      </div>
      <div style="background:white;padding:8px 24px 24px;border:1px solid #e5e7eb;border-top:none;">
        <table style="width:100%;border-collapse:collapse;margin-top:12px;">
          <thead><tr style="background:#f9fafb;">
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Carrier</th>
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Resolved</th>
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">&nbsp;</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`

    await resend.emails.send({ from, to, subject, html })
    return { sent: true }
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : 'send failed' }
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
          ${c.issues.map((i) => esc(i)).join('<br/>')}
        </td>
        <td style="padding:8px;border:1px solid #e5e7eb;vertical-align:top;">${link(c.dotNumber)}</td>
      </tr>`
      })
      .join('')

    const subject = `DTS Insurance Expiry — ${carriers.length} active carrier${carriers.length === 1 ? '' : 's'} with expired coverage`
    const html = `
    <div style="font-family:sans-serif;max-width:900px;margin:0 auto;">
      <div style="background:#AB0534;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h1 style="margin:0;font-size:20px;">Carriers With Expired Insurance</h1>
        <p style="margin:4px 0 0;opacity:0.85;font-size:14px;">${carriers.length} active carrier${carriers.length === 1 ? '' : 's'} — do not use until coverage is restored.</p>
      </div>
      <div style="background:white;padding:8px 24px 24px;border:1px solid #e5e7eb;border-top:none;">
        <table style="width:100%;border-collapse:collapse;margin-top:12px;">
          <thead><tr style="background:#f9fafb;">
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Carrier</th>
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Expired Coverage</th>
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">&nbsp;</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`

    await resend.emails.send({ from, to, subject, html })
    return { sent: true }
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : 'send failed' }
  }
}

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
export interface DailyDigestPayload {
  since: string
  until: string
  hardStops: DigestCarrier[]
  reviews: DigestCarrier[]
  replies: DigestReply[]
  /** Count of carriers flagged for re-vet by a score upload (summarized, not listed). */
  scoreFlagged?: number
}

/**
 * Send the once-a-day digest to the DTS compliance inbox. Returns whether it
 * sent so the caller can record the run; never throws.
 */
export async function sendDailyDigest(
  payload: DailyDigestPayload
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
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''
    const resend = new Resend(apiKey)

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
    const dateLabel = new Date(payload.until).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })

    const subject =
      hs > 0
        ? `DTS Daily Digest — ${hs} hard stop${hs === 1 ? '' : 's'}, ${rv} to review (${dateLabel})`
        : `DTS Daily Digest — ${rv} to review${rp ? `, ${rp} RMIS repl${rp === 1 ? 'y' : 'ies'}` : ''} (${dateLabel})`

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
          ${issuesOf(c).map((i) => esc(i)).join('<br/>')}
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
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Issue</th>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">&nbsp;</th>
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>`
        : ''

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
        <h1 style="margin:0;font-size:20px;">DTS Carrier Daily Digest</h1>
        <p style="margin:4px 0 0;opacity:0.85;font-size:14px;">
          ${dateLabel} · ${hs} hard stop${hs === 1 ? '' : 's'}, ${rv} to review${rp ? `, ${rp} RMIS repl${rp === 1 ? 'y' : 'ies'}` : ''}${sf ? ` · ${sf} flagged for re-vet` : ''}
        </p>
      </div>
      <div style="background:white;padding:8px 24px 24px;border:1px solid #e5e7eb;border-top:none;">
        ${section(`Hard Stops — Do Not Use Until Resolved (${hs})`, '#dc2626', carrierRows(payload.hardStops, '#dc2626', (c) => c.hardStops))}
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
        ${hs + rv + rp + sf === 0 ? `<p style="color:#6b7280;">Nothing new needs attention today.</p>` : ''}
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;">
          <a href="${APP_URL}/carriers"
             style="background:#0063A0;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;font-size:14px;">
            Open Carrier Portal
          </a>
        </div>
      </div>
    </div>`

    await resend.emails.send({ from, to, subject, html })
    return { sent: true }
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : 'send failed' }
  }
}
