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
