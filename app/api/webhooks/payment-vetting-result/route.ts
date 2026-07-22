import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { logCarrierEvent } from '@/lib/auditLog'
import { isMachineOrSessionAuthorized } from '@/lib/machineAuth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUCKET = 'carrier-documents'

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'payment-vetting-log.pdf'
}

// POST /api/webhooks/payment-vetting-result
//
// Called by the n8n workflow when the vetting-log PDF is ready. Attaches it to
// the carrier's Documents (as a `payment_vetting_log`) and stamps the Activity
// timeline. The PDF arrives as base64 (`contentBase64`) — vetting-log PDFs are
// small — or, if the workflow uploaded straight to Storage, as `storagePath`.
export async function POST(request: Request) {
  if (!(await isMachineOrSessionAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await request.json().catch(() => null)
    const dot = String(body?.dot ?? '').replace(/\D/g, '')
    if (!dot) return NextResponse.json({ error: 'Missing dot' }, { status: 400 })

    const { data: carrier } = await supabaseAdmin
      .from('carriers')
      .select('id')
      .eq('dot_number', dot)
      .maybeSingle()
    if (!carrier) {
      return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })
    }

    const fileName = sanitizeName(String(body?.fileName ?? 'payment-vetting-log.pdf'))
    const mimeType = body?.mimeType ? String(body.mimeType) : 'application/pdf'
    let storagePath: string | null = body?.storagePath ? String(body.storagePath) : null
    let fileSize: number | null = null

    // If the PDF came as base64, upload it to Storage now.
    if (!storagePath && body?.contentBase64) {
      const b64 = String(body.contentBase64).replace(/^data:[^;]+;base64,/, '')
      const bytes = Buffer.from(b64, 'base64')
      fileSize = bytes.byteLength
      const path = `${dot}/payment-vetting/${Date.now()}-${fileName}`
      const { error: upErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: mimeType, upsert: true })
      if (upErr) throw upErr
      storagePath = path
    }
    if (!storagePath) {
      return NextResponse.json(
        { error: 'Provide the PDF as contentBase64 or a storagePath' },
        { status: 400 }
      )
    }

    const { data: document, error: insErr } = await supabaseAdmin
      .from('vetting_documents')
      .insert([
        {
          carrier_id: (carrier as any).id,
          dot_number: dot,
          document_type: 'payment_vetting_log',
          file_name: fileName,
          file_size_bytes: fileSize,
          mime_type: mimeType,
          storage_bucket: BUCKET,
          storage_path: storagePath,
          uploaded_by: body?.staffName ? String(body.staffName) : 'Payment vetting workflow',
        },
      ])
      .select('*')
      .single()
    if (insErr) throw insErr

    const load = body?.loadNumber ? ` (load ${String(body.loadNumber)})` : ''
    const verdict = body?.summary ? ` — ${String(body.summary).slice(0, 200)}` : ''
    await logCarrierEvent({
      dot,
      carrierId: (carrier as any).id ?? null,
      type: 'payment_vetting',
      summary: `Payment vetting log attached${load}${verdict}`,
      detail: { email: body?.email ?? null, loadNumber: body?.loadNumber ?? null },
      actor: 'Payment vetting workflow',
    })

    return NextResponse.json({ ok: true, documentId: (document as any).id })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
