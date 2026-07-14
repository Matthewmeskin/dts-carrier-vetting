import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { logCarrierEvent } from '@/lib/auditLog'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST — receive an inbound email (a reply from RMIS/Truckstop to one of our
// insurance-update requests) from an inbound-email provider, match it to a
// carrier by the DOT in the subject, and log it to that carrier's activity
// timeline. Provider-agnostic: accepts a JSON body (Resend wraps fields under
// `data`) or form-encoded (SendGrid Inbound Parse).
//
// SECURITY: the email content is untrusted external input. We only store and
// classify it — we never act on any instruction contained in it.
//
// Auth: pass ?token=<INBOUND_EMAIL_SECRET|CRON_SECRET> or an X-Webhook-Secret
// header (some providers can only add a query string).
export async function POST(request: NextRequest) {
  try {
    const secret = process.env.INBOUND_EMAIL_SECRET || process.env.CRON_SECRET
    const provided =
      request.nextUrl.searchParams.get('token') ||
      request.headers.get('x-webhook-secret') ||
      ''
    if (!secret || provided !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const ct = request.headers.get('content-type') || ''
    let payload: any = {}
    if (ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
      const fd = await request.formData()
      payload = Object.fromEntries(Array.from(fd.entries()).map(([k, v]) => [k, String(v)]))
    } else {
      try {
        payload = await request.json()
      } catch {
        payload = {}
      }
    }
    // Resend inbound wraps the message under `data`; others are flat.
    let d = payload?.data ?? payload

    // Resend's `email.received` webhook carries metadata ONLY (no body). Fetch
    // the full message from the Received Emails API before we parse/classify it.
    if (payload?.type === 'email.received' && d?.email_id && process.env.RESEND_API_KEY) {
      try {
        const res = await fetch(
          `https://api.resend.com/emails/receiving/${d.email_id}`,
          {
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
            cache: 'no-store',
          }
        )
        if (res.ok) {
          const full = await res.json()
          d = { ...d, ...(full?.data ?? full) }
        }
      } catch {
        /* fall back to the metadata we already have */
      }
    }

    const from = d.from ?? d.From ?? d.sender ?? d.envelope_from ?? ''
    const subject = d.subject ?? d.Subject ?? d.headers?.subject ?? ''
    const text: string =
      d.text ?? d.Text ?? d['stripped-text'] ?? d.plain ?? d.html ?? d.Html ?? ''

    const hay = `${subject} ${text}`
    const dotMatch = hay.match(/\bDOT[\s#:.-]*?(\d{5,8})\b/i)
    const mcMatch = hay.match(/\bMC[\s#:.-]*?(\d{3,8})\b/i)
    const dot = dotMatch?.[1] ?? null

    // Light keyword classification of the reply (no AI needed).
    const t = hay.toLowerCase()
    let classification: string = 'other'
    if (/(not\s+yet\s+received|have\s+not\s+received|no\s+(coi|certificate)|awaiting\s+(the\s+)?coi)/.test(t))
      classification = 'coi_not_received'
    else if (/(updated|processed|on\s+file|certified|received\s+the\s+(coi|certificate)|renewed)/.test(t))
      classification = 'updated'

    if (!dot) {
      // Nothing to attach it to — acknowledge so the provider doesn't retry.
      return NextResponse.json({ matched: false, note: 'No DOT found in subject/body.' })
    }

    // Resolve the carrier id (best-effort).
    const { data: carrier } = await supabaseAdmin
      .from('carriers')
      .select('id, legal_name')
      .eq('dot_number', dot)
      .maybeSingle()

    const snippet = String(text).replace(/\s+/g, ' ').trim().slice(0, 400)
    const label =
      classification === 'coi_not_received'
        ? 'RMIS reply — COI not yet received'
        : classification === 'updated'
          ? 'RMIS reply — insurance updated'
          : 'RMIS reply received'

    await logCarrierEvent({
      dot,
      carrierId: (carrier as any)?.id ?? null,
      type: 'insurance_refresh_response',
      summary: `${label}: ${subject}`.slice(0, 300),
      detail: {
        from,
        subject,
        classification,
        mc: mcMatch?.[1] ?? null,
        snippet,
      },
      actor: 'RMIS (Truckstop)',
    })

    return NextResponse.json({ matched: true, dot, classification })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
