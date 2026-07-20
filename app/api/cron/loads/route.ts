import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// Daily carrier-haul ingest (Policy §4 — "not hauled in N days"). n8n pulls
// completed loads from the TMS once a day at 3am (Hyperion GetLoads over a
// rolling window — status=Delivered preferred, so every load that completed in
// the window is captured, not just those in flight at run time) and POSTs the
// raw loads array here. For each load's PRIMARY carrier we record the haul date
// against the carrier (matched by MC number), keeping only the most recent
// date. This powers the dormancy signal; it never resets the re-vet clock
// (see lib/revet.ts).

interface LoadCarrier {
  carrierMCNumber?: string | null
  carrierName?: string | null
  isPrimary?: boolean
}
interface LoadObj {
  loadId?: number | string
  deliveryDate?: string | null
  pickupDate?: string | null
  createdate?: string | null
  carriers?: LoadCarrier[] | null
}

/** MC number reduced to digits so "MC-307158" and "307158" compare equal. */
function normalizeMc(mc: string | null | undefined): string {
  return (mc ?? '').replace(/\D/g, '')
}

/** Best available "hauled on" date for a load — delivery preferred (completed),
 *  then pickup, then created. */
function loadDate(load: LoadObj): string | null {
  const raw = load.deliveryDate || load.pickupDate || load.createdate
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    // Accept either { loads: [...] } or a bare array.
    const loads: LoadObj[] = Array.isArray(body)
      ? body
      : Array.isArray(body?.loads)
        ? body.loads
        : []
    if (loads.length === 0) {
      return NextResponse.json(
        { error: 'No loads provided (expected { loads: [...] })' },
        { status: 400 }
      )
    }

    // 1. Aggregate the latest pickup date per MC number from this batch.
    const latestByMc = new Map<string, string>()
    let loadsWithoutMc = 0
    for (const load of loads) {
      const carriers = load.carriers ?? []
      const primary =
        carriers.find((c) => c.isPrimary === true) ?? carriers[0] ?? null
      const mc = normalizeMc(primary?.carrierMCNumber)
      const iso = loadDate(load)
      if (!mc || !iso) {
        if (!mc) loadsWithoutMc++
        continue
      }
      const prev = latestByMc.get(mc)
      if (!prev || iso > prev) latestByMc.set(mc, iso)
    }

    if (latestByMc.size === 0) {
      return NextResponse.json({
        loadsReceived: loads.length,
        loadsWithoutMc,
        mcMatched: 0,
        carriersUpdated: 0,
      })
    }

    // 2. Page through carriers that have an MC and build a digits-only index.
    //    (mc_number formatting varies, so we normalize both sides in memory.)
    const carrierByMc = new Map<
      string,
      { id: string; last: string | null }[]
    >()
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from('carriers')
        .select('id, mc_number, last_hauled_at')
        .not('mc_number', 'is', null)
        .range(from, from + PAGE - 1)
      if (error) throw error
      const rows = data ?? []
      for (const r of rows as any[]) {
        const mc = normalizeMc(r.mc_number)
        if (!mc) continue
        const entry = { id: r.id as string, last: (r.last_hauled_at as string) ?? null }
        const list = carrierByMc.get(mc)
        if (list) list.push(entry)
        else carrierByMc.set(mc, [entry])
      }
      if (rows.length < PAGE) break
    }

    // 3. Collect forward-only updates (only when the batch date is newer).
    const updates: { id: string; last_hauled_at: string }[] = []
    let mcMatched = 0
    for (const [mc, iso] of Array.from(latestByMc.entries())) {
      const carriers = carrierByMc.get(mc)
      if (!carriers || carriers.length === 0) continue
      mcMatched++
      for (const c of carriers) {
        if (!c.last || iso > c.last) {
          updates.push({ id: c.id, last_hauled_at: iso })
        }
      }
    }

    // 4. Apply updates with a small concurrency cap.
    let carriersUpdated = 0
    const CONCURRENCY = 20
    for (let i = 0; i < updates.length; i += CONCURRENCY) {
      const slice = updates.slice(i, i + CONCURRENCY)
      await Promise.all(
        slice.map(async (u) => {
          const { error } = await supabaseAdmin
            .from('carriers')
            .update({ last_hauled_at: u.last_hauled_at } as any)
            .eq('id', u.id)
          if (!error) carriersUpdated++
          else console.error(`last_hauled_at update failed for ${u.id}:`, error)
        })
      )
    }

    return NextResponse.json({
      loadsReceived: loads.length,
      loadsWithoutMc,
      distinctMc: latestByMc.size,
      mcMatched,
      carriersUpdated,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
