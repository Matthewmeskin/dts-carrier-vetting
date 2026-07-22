import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeCarrierName } from '@/lib/carrierNameMatch'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/admin/w9-match  { fileNames: string[] }
//
// Matches each W-9 filename to a carrier by normalized legal/DBA name, so the
// bulk W-9 uploader knows which carrier each file belongs to. Returns, per file,
// the matched carrier (if any) and whether that carrier already has a W-9 copy
// on file — so the uploader can skip / flag duplicates and ambiguous matches.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const fileNames: string[] = Array.isArray(body?.fileNames)
      ? body.fileNames.map((f: unknown) => String(f))
      : []
    if (fileNames.length === 0) {
      return NextResponse.json({ error: 'No file names provided' }, { status: 400 })
    }

    // All carriers, normalized. Build lookup maps for legal + DBA names.
    const { data: carriers, error } = await supabaseAdmin
      .from('carriers')
      .select('id, dot_number, mc_number, legal_name, dba_name')
    if (error) throw error

    // Carriers that already have an uploaded W-9 document in the portal.
    const { data: w9docs } = await supabaseAdmin
      .from('vetting_documents')
      .select('carrier_id')
      .eq('document_type', 'w9')
    const haveW9 = new Set(
      (w9docs ?? []).map((d: any) => d.carrier_id).filter(Boolean)
    )

    // Map normalized name -> list of carriers (to detect ambiguous matches).
    const byNorm = new Map<string, any[]>()
    for (const c of carriers ?? []) {
      for (const raw of [(c as any).legal_name, (c as any).dba_name]) {
        const n = normalizeCarrierName(raw)
        if (!n) continue
        if (!byNorm.has(n)) byNorm.set(n, [])
        const arr = byNorm.get(n)!
        if (!arr.find((x) => x.id === (c as any).id)) arr.push(c)
      }
    }

    const results = fileNames.map((fileName) => {
      const norm = normalizeCarrierName(fileName)
      const hits = byNorm.get(norm) ?? []
      if (hits.length === 1) {
        const c = hits[0]
        return {
          fileName,
          status: haveW9.has(c.id) ? ('already_has_w9' as const) : ('matched' as const),
          carrierId: c.id as string,
          dot: c.dot_number as string,
          legalName: (c.legal_name as string) ?? null,
          dbaName: (c.dba_name as string) ?? null,
        }
      }
      if (hits.length > 1) {
        return {
          fileName,
          status: 'ambiguous' as const,
          candidates: hits.map((c) => ({
            carrierId: c.id,
            dot: c.dot_number,
            legalName: c.legal_name,
          })),
        }
      }
      return { fileName, status: 'unmatched' as const }
    })

    return NextResponse.json({ results })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Match failed' }, { status: 500 })
  }
}
