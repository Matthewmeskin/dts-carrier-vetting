import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { logCarrierEvent } from '@/lib/auditLog'
import { getSessionUser } from '@/lib/authServer'
import { ROLE_LABEL } from '@/lib/roles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUCKET = 'carrier-documents'
const SIGNED_TTL = 60 * 60 * 2 // 2 hours — long enough for n8n to fetch each doc

// POST /api/carriers/[dot]/payment-vetting
//
// Kicks the payment-vetting workflow. The browser has already uploaded the
// invoice / BOL / dispatch / POD / NOA straight to Storage (via /documents/sign)
// and passes their storage paths here. We mint short-lived signed download URLs
// for each and hand them — plus the destination email and portal callback URLs —
// to the n8n webhook. n8n pulls carrier context from /api/webhooks/payment-context,
// runs the AI + payment-fraud analysis, emails the PDF to `email`, and POSTs the
// finished PDF back to /api/webhooks/payment-vetting-result to attach it here.
export async function POST(
  request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const dot = params.dot
    const body = await request.json().catch(() => null)
    const email = String(body?.email ?? '').trim()
    const staffName = body?.staffName ? String(body.staffName).trim() : null
    const loadNumber = body?.loadNumber ? String(body.loadNumber).trim() : null
    const docs: Array<{
      type: string
      storagePath: string
      fileName?: string
      mimeType?: string
    }> = Array.isArray(body?.docs) ? body.docs : []

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: 'A valid destination email is required' }, { status: 400 })
    }
    if (docs.length === 0) {
      return NextResponse.json(
        { error: 'At least one load document is required' },
        { status: 400 }
      )
    }

    const webhookUrl = process.env.N8N_PAYMENT_VETTING_WEBHOOK_URL
    if (!webhookUrl) {
      return NextResponse.json(
        { error: 'Payment-vetting workflow is not configured (missing N8N_PAYMENT_VETTING_WEBHOOK_URL).' },
        { status: 503 }
      )
    }

    const { data: carrier } = await supabaseAdmin
      .from('carriers')
      .select('id, legal_name')
      .eq('dot_number', dot)
      .maybeSingle()
    if (!carrier) {
      return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })
    }

    // Sign each uploaded doc for download by n8n.
    const signedDocs = await Promise.all(
      docs.map(async (d) => {
        const { data: signed } = await supabaseAdmin.storage
          .from(BUCKET)
          .createSignedUrl(d.storagePath, SIGNED_TTL)
        return {
          type: d.type,
          fileName: d.fileName ?? null,
          mimeType: d.mimeType ?? null,
          url: signed?.signedUrl ?? null,
        }
      })
    )
    const usableDocs = signedDocs.filter((d) => d.url)
    if (usableDocs.length === 0) {
      return NextResponse.json({ error: 'Uploaded documents could not be read from storage' }, { status: 500 })
    }

    const base = new URL(request.url).origin
    const payload = {
      dot,
      carrierName: (carrier as any).legal_name ?? null,
      email,
      staffName,
      loadNumber,
      docs: usableDocs,
      // The workflow pulls carrier data from the portal and posts the PDF back.
      contextUrl: `${base}/api/webhooks/payment-context?dot=${encodeURIComponent(dot)}`,
      resultUrl: `${base}/api/webhooks/payment-vetting-result`,
      // Merges the original load docs into the final report PDF before emailing.
      mergeUrl: `${base}/api/webhooks/payment-vetting-merge`,
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      return NextResponse.json(
        { error: `Workflow trigger failed (${res.status}). ${txt.slice(0, 300)}` },
        { status: 502 }
      )
    }

    const user = await getSessionUser()
    const actor = user
      ? `${user.fullName || user.email}${user.role ? ` (${ROLE_LABEL[user.role]})` : ''}`
      : staffName || 'DTS'

    await logCarrierEvent({
      dot,
      carrierId: (carrier as any).id ?? null,
      type: 'payment_vetting',
      summary: `Payment vetting started${loadNumber ? ` for load ${loadNumber}` : ''} — report will be emailed to ${email}.`,
      detail: { email, loadNumber, docTypes: usableDocs.map((d) => d.type) },
      actor,
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
