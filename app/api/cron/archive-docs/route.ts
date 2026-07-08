import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchExpandedCarrierXML, RMISCredentials } from '@/lib/rmisClient'
import { archiveCarrierDocuments } from '@/lib/rmisArchive'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const DEFAULT_BATCH = 10

// POST — re-pull RMIS documents for a batch of carriers so any documents on file
// in RMIS (notably NOAs for factoring carriers) get archived into the portal.
//
// Default target ("missing_noa"): factoring carriers in RMIS with no NOA
// archived. Cycles least-recently-refreshed first via carriers.docs_refreshed_at,
// so a carrier that genuinely has no doc in RMIS is stamped and skipped next run
// rather than reprocessed forever. Modes:
//   {"mode":"missing_docs"} — any carrier RMIS says has a W-9 / broker-carrier
//        agreement / NOA on file but for which we have no archived copy.
//   {"mode":"all"}          — refresh docs for any in-RMIS carrier.
//   {"dots":["123","456"]}  — force-refresh exactly these carriers (bypasses the
//        recency guard); use when a specific carrier shows a doc on file but has
//        nothing archived.
export async function POST(request: Request) {
  try {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    const batchSize =
      Number(body?.batchSize) > 0 ? Number(body.batchSize) : DEFAULT_BATCH
    const mode: 'missing_noa' | 'missing_docs' | 'all' =
      body?.mode === 'all'
        ? 'all'
        : body?.mode === 'missing_docs'
          ? 'missing_docs'
          : 'missing_noa'
    // Explicit target DOTs — force-refresh exactly these (skips the recency
    // guard and mode filtering). Useful when a specific carrier shows a document
    // "on file" in RMIS but has none archived here.
    const explicitDots: string[] | null =
      Array.isArray(body?.dots) && body.dots.length > 0
        ? body.dots.map((d: any) => String(d).trim()).filter(Boolean).slice(0, 100)
        : null
    const creds: RMISCredentials | undefined =
      body?.clientID || body?.clientPassword
        ? { clientID: body.clientID, clientPassword: body.clientPassword }
        : undefined

    // Build the target dot set.
    let targetDots: Set<string> | null = null
    if (explicitDots) {
      targetDots = new Set(explicitDots)
    } else if (mode === 'missing_noa') {
      const [{ data: factoring }, { data: noa }] = await Promise.all([
        (supabaseAdmin as any)
          .from('latest_carrier_insurance')
          .select('dot_number')
          .eq('is_factoring', true)
          .limit(100000),
        supabaseAdmin
          .from('vetting_documents')
          .select('dot_number')
          .eq('document_type', 'noa')
          .limit(100000),
      ])
      const noaSet = new Set((noa ?? []).map((r: any) => String(r.dot_number)))
      targetDots = new Set(
        (factoring ?? [])
          .map((r: any) => String(r.dot_number))
          .filter((d: string) => !noaSet.has(d))
      )
      if (targetDots.size === 0) {
        return NextResponse.json({ processed: 0, note: 'No factoring carriers missing an NOA.' })
      }
    } else if (mode === 'missing_docs') {
      // Carriers RMIS reports as having a W-9 / broker-carrier agreement / NOA
      // (factoring) on file, but for which we have no archived copy of that type.
      const [{ data: ins }, { data: docs }] = await Promise.all([
        (supabaseAdmin as any)
          .from('latest_carrier_insurance')
          .select('dot_number, w9_on_file, broker_carrier_agreement_on_file, is_factoring')
          .limit(100000),
        supabaseAdmin
          .from('vetting_documents')
          .select('dot_number, document_type')
          .eq('source', 'rmis')
          .limit(100000),
      ])
      const haveByDot = new Map<string, Set<string>>()
      for (const d of docs ?? []) {
        const k = String((d as any).dot_number)
        if (!haveByDot.has(k)) haveByDot.set(k, new Set())
        haveByDot.get(k)!.add(String((d as any).document_type))
      }
      // Target only on the reliably-fetchable document types (W-9 + NOA). Broker-
      // carrier agreements are excluded as a *trigger* because RMIS only returns a
      // file for agreements uploaded as a document, not for ones e-signed inside
      // RMIS — using them as a trigger would re-attempt those carriers forever
      // without ever archiving anything. Any agreement PDF that does exist is
      // still archived incidentally when the carrier is pulled for a W-9/NOA.
      targetDots = new Set<string>()
      for (const r of ins ?? []) {
        const dot = String((r as any).dot_number)
        const have = haveByDot.get(dot) ?? new Set<string>()
        const need: string[] = []
        if ((r as any).w9_on_file) need.push('w9')
        if ((r as any).is_factoring) need.push('noa')
        if (need.some((t) => !have.has(t))) targetDots.add(dot)
      }
      if (targetDots.size === 0) {
        return NextResponse.json({ processed: 0, note: 'No carriers missing an on-file document.' })
      }
    }

    // Skip carriers refreshed within the last 7 days so a carrier that genuinely
    // has no NOA in RMIS isn't re-pulled every run once the backlog is drained.
    const staleBefore = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()

    // Least-recently-refreshed carriers that are in RMIS (have an insured id).
    const { data: candidates, error } = await supabaseAdmin
      .from('carriers')
      .select('id, dot_number, rmis_insured_id, docs_refreshed_at')
      .not('rmis_insured_id', 'is', null)
      .order('docs_refreshed_at', { ascending: true, nullsFirst: true })
      .limit(targetDots ? 5000 : batchSize)
    if (error) throw error

    // Apply the target-dot filter + recency guard, then batch. Explicit DOTs
    // bypass the recency guard so a just-refreshed carrier can still be forced.
    const picked = (candidates ?? [])
      .filter((c: any) => !targetDots || targetDots.has(String(c.dot_number)))
      .filter(
        (c: any) =>
          explicitDots || !c.docs_refreshed_at || c.docs_refreshed_at < staleBefore
      )
      .slice(0, explicitDots ? explicitDots.length : batchSize)

    let succeeded = 0
    let failed = 0
    let archived = 0
    const now = new Date().toISOString()

    for (const c of picked) {
      const dot = (c as any).dot_number
      try {
        const xml = await fetchExpandedCarrierXML({
          insdID: (c as any).rmis_insured_id || undefined,
          dotNumber: dot,
          credentials: creds,
        })
        const res = await archiveCarrierDocuments({
          dot,
          carrierId: (c as any).id,
          insdID: String((c as any).rmis_insured_id),
          xml,
        })
        archived += res.archived
        succeeded++
      } catch {
        failed++
      } finally {
        await supabaseAdmin
          .from('carriers')
          .update({ docs_refreshed_at: now } as any)
          .eq('dot_number', dot)
      }
    }

    // How many targets remain (target-set modes).
    let remaining: number | null = null
    if (!explicitDots && targetDots) {
      const stampedThisRun = new Set(picked.map((c: any) => String(c.dot_number)))
      remaining = Array.from(targetDots).filter((d) => !stampedThisRun.has(d)).length
    }

    return NextResponse.json({
      mode: explicitDots ? 'explicit_dots' : mode,
      processed: picked.length,
      succeeded,
      failed,
      documentsArchived: archived,
      remainingTargets: remaining,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}
