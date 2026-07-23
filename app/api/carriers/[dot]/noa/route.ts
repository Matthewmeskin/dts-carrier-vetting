import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { noaVerifyConfigured, verifyNOA } from '@/lib/noaVerify'
import { logCarrierEvent } from '@/lib/auditLog'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

async function latestNoaDoc(dot: string) {
  const { data } = await supabaseAdmin
    .from('vetting_documents')
    .select('id, file_name, mime_type, storage_bucket, storage_path, uploaded_at')
    .eq('dot_number', dot)
    .eq('document_type', 'noa')
    .order('uploaded_at', { ascending: false })
    .limit(1)
  return data && data.length > 0 ? (data[0] as any) : null
}

async function lastVerification(dot: string) {
  const { data } = await (supabaseAdmin as any)
    .from('noa_verifications')
    .select('result, checked_at')
    .eq('dot_number', dot)
    .order('checked_at', { ascending: false })
    .limit(1)
  return data && data.length > 0 ? data[0] : null
}

// GET — NOA status: is one on file, and the last verification (if any).
export async function GET(
  _request: Request,
  { params }: { params: { dot: string } }
) {
  const doc = await latestNoaDoc(params.dot)
  const last = await lastVerification(params.dot)
  return NextResponse.json({
    configured: noaVerifyConfigured(),
    onFile: Boolean(doc),
    fileName: doc?.file_name ?? null,
    uploadedAt: doc?.uploaded_at ?? null,
    verification: last?.result ?? null,
    checkedAt: last?.checked_at ?? null,
  })
}

// POST — read the NOA PDF and verify assignee + pay-to against RMIS.
export async function POST(
  _request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    if (!noaVerifyConfigured()) {
      return NextResponse.json(
        { error: 'NOA verification is not configured (set ANTHROPIC_API_KEY).' },
        { status: 503 }
      )
    }

    const doc = await latestNoaDoc(params.dot)
    if (!doc) {
      return NextResponse.json(
        { error: 'No Notice of Assignment is on file for this carrier.' },
        { status: 404 }
      )
    }

    // Pull the PDF bytes from storage.
    const dl = await supabaseAdmin.storage
      .from(doc.storage_bucket)
      .download(doc.storage_path)
    if (dl.error || !dl.data) {
      throw new Error('Could not download the NOA document from storage.')
    }
    const buffer = Buffer.from(await dl.data.arrayBuffer())
    const base64 = buffer.toString('base64')

    // Expected details: carrier, linked factor, RMIS pay-to.
    const [{ data: carrier }, { data: ins }] = await Promise.all([
      supabaseAdmin
        .from('carriers')
        .select('id, legal_name, factor_id')
        .eq('dot_number', params.dot)
        .single(),
      (supabaseAdmin as any)
        .from('latest_carrier_insurance')
        .select('pay_to_entity, pay_to_address')
        .eq('dot_number', params.dot)
        .limit(1),
    ])
    let factorName: string | null = null
    if ((carrier as any)?.factor_id) {
      const { data: f } = await supabaseAdmin
        .from('factors')
        .select('name')
        .eq('id', (carrier as any).factor_id)
        .single()
      factorName = (f as any)?.name ?? null
    }
    const insurance = ins && ins.length > 0 ? ins[0] : null

    const verification = await verifyNOA({
      documentBase64: base64,
      mediaType: doc.mime_type || 'application/pdf',
      carrierName: (carrier as any)?.legal_name ?? null,
      factorName: factorName ?? insurance?.pay_to_entity ?? null,
      payToEntity: insurance?.pay_to_entity ?? null,
      payToAddress: insurance?.pay_to_address ?? null,
    })

    // Persist + audit.
    await (supabaseAdmin as any).from('noa_verifications').insert([
      {
        dot_number: params.dot,
        carrier_id: (carrier as any)?.id ?? null,
        document_id: doc.id,
        result: verification,
      },
    ])
    const clean =
      verification.is_noa &&
      verification.carrier_name_matches !== false &&
      verification.assignee_matches_factor &&
      verification.payto_address_match === 'match' &&
      verification.discrepancies.length === 0
    await logCarrierEvent({
      dot: params.dot,
      carrierId: (carrier as any)?.id ?? null,
      type: 'noa_check',
      summary: clean
        ? 'NOA verified — assignee and pay-to address match.'
        : `NOA reviewed — ${verification.discrepancies.length} discrepancy(ies): ${verification.discrepancies
            .slice(0, 2)
            .join('; ')}`,
      detail: { verification },
      actor: 'NOA reader',
    })

    return NextResponse.json({ configured: true, onFile: true, verification })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'NOA verification failed' },
      { status: 500 }
    )
  }
}
