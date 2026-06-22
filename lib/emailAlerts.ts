import { Resend } from 'resend'

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
