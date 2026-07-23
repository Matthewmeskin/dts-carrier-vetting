import { supabaseAdmin } from '@/lib/supabase'
import { noaVerifyConfigured, verifyNOA } from '@/lib/noaVerify'
import { logCarrierEvent } from '@/lib/auditLog'

// Run the on-file NOA verification for a carrier and persist it to
// `noa_verifications` — the same work as POST /api/carriers/[dot]/noa, factored
// out so the payment-vetting context pull can populate the NOA result when it's
// missing. Best-effort: returns false (never throws) when NOA verification isn't
// configured, no NOA is on file, or anything goes wrong.
export async function runNoaCheck(dot: string): Promise<boolean> {
  if (!noaVerifyConfigured()) return false
  try {
    const { data: docs } = await supabaseAdmin
      .from('vetting_documents')
      .select('id, file_name, mime_type, storage_bucket, storage_path')
      .eq('dot_number', dot)
      .eq('document_type', 'noa')
      .order('uploaded_at', { ascending: false })
      .limit(1)
    const doc = docs && docs.length > 0 ? (docs[0] as any) : null
    if (!doc?.storage_path) return false

    const dl = await supabaseAdmin.storage
      .from(doc.storage_bucket)
      .download(doc.storage_path)
    if (dl.error || !dl.data) return false
    const base64 = Buffer.from(await dl.data.arrayBuffer()).toString('base64')

    const [{ data: carrier }, { data: ins }] = await Promise.all([
      supabaseAdmin
        .from('carriers')
        .select('id, legal_name, factor_id')
        .eq('dot_number', dot)
        .single(),
      (supabaseAdmin as any)
        .from('latest_carrier_insurance')
        .select('pay_to_entity, pay_to_address')
        .eq('dot_number', dot)
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
    const insurance = ins && ins.length > 0 ? (ins[0] as any) : null

    const verification = await verifyNOA({
      documentBase64: base64,
      mediaType: doc.mime_type || 'application/pdf',
      carrierName: (carrier as any)?.legal_name ?? null,
      factorName: factorName ?? insurance?.pay_to_entity ?? null,
      payToEntity: insurance?.pay_to_entity ?? null,
      payToAddress: insurance?.pay_to_address ?? null,
    })

    await (supabaseAdmin as any).from('noa_verifications').insert([
      {
        dot_number: dot,
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
      dot,
      carrierId: (carrier as any)?.id ?? null,
      type: 'noa_check',
      summary: clean
        ? 'NOA verified — assignee and pay-to address match.'
        : `NOA reviewed — ${verification.discrepancies.length} discrepancy(ies): ${verification.discrepancies
            .slice(0, 2)
            .join('; ')}`,
      detail: { verification },
      actor: 'Payment vetting',
    })
    return true
  } catch (e) {
    console.error('runNoaCheck failed:', e)
    return false
  }
}
