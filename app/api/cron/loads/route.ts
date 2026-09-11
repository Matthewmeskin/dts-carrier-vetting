import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { parseCarrierAndFactor } from '@/lib/carrierName'

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
  carrierProNumber?: string | null
  remitTo?: string | null
  remitAddress?: string | null
  isPrimary?: boolean
}
interface LoadStop {
  stopType?: string | null
  fullAddress?: string | null
}
interface LoadObj {
  loadId?: number | string
  bolNum?: string | null
  pickNum?: string | null
  shipmentStatus?: string | null
  shipmentMode?: string | null
  customerName?: string | null
  targetRate?: number | null
  value?: number | null
  items?: Array<{ billed?: number | null }> | null
  accessorials?: Array<{ bill?: number | null }> | null
  stops?: LoadStop[] | null
  estimatedDelivery?: string | null
  deliveryDate?: string | null
  pickupDate?: string | null
  createdate?: string | null
  carriers?: LoadCarrier[] | null
}

function num(v: any): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function nullIf(v: any): string | null {
  const s = v == null ? '' : String(v).trim()
  return s && s !== '-' ? s : null
}

// Map a full Hyperion load to a `loads` row (null when it has no loadId).
function toLoadRow(load: LoadObj): Record<string, any> | null {
  const loadId = num(load.loadId)
  if (loadId === null) return null
  const carriers = load.carriers ?? []
  const primary = carriers.find((c) => c.isPrimary === true) ?? carriers[0] ?? null
  const stops = load.stops ?? []
  const origin = stops.find((s) => /pick/i.test(s.stopType || ''))?.fullAddress ?? null
  const destination =
    stops.find((s) => /drop|deliv/i.test(s.stopType || ''))?.fullAddress ?? null
  const itemsBilled = (load.items ?? []).reduce((a, it) => a + (num(it.billed) ?? 0), 0)
  const accBilled = (load.accessorials ?? []).reduce((a, ac) => a + (num(ac.bill) ?? 0), 0)
  const totalBilled = itemsBilled + accBilled
  return {
    load_id: loadId,
    bol_num: nullIf(load.bolNum),
    pick_num: nullIf(load.pickNum),
    shipment_status: nullIf(load.shipmentStatus),
    shipment_mode: nullIf(load.shipmentMode),
    customer_name: nullIf(load.customerName),
    primary_carrier_name: nullIf(primary?.carrierName),
    primary_carrier_mc: nullIf(primary?.carrierMCNumber),
    primary_carrier_pro: nullIf(primary?.carrierProNumber),
    remit_to: nullIf(primary?.remitTo),
    remit_address: nullIf(primary?.remitAddress),
    target_rate: num(load.targetRate),
    value: num(load.value),
    total_billed: totalBilled || null,
    origin,
    destination,
    pickup_date: nullIf(load.pickupDate),
    delivery_date: nullIf(load.deliveryDate),
    estimated_delivery: nullIf(load.estimatedDelivery),
    raw: load as any,
    synced_at: new Date().toISOString(),
  }
}

/** MC number reduced to digits so "MC-307158" and "307158" compare equal. */
function normalizeMc(mc: string | null | undefined): string {
  return (mc ?? '').replace(/\D/g, '')
}

/** Carrier name reduced to a comparable key: Brokerware suffixes like "(*)",
 *  "(#)" or "(*A) CA Only" and the "/Factor" tail are dropped, then case and
 *  punctuation are ignored, so "EDI Express, Inc." matches "EDI EXPRESS INC". */
function nameKey(name: string | null | undefined): string {
  if (!name) return ''
  const base = parseCarrierAndFactor(name).carrierName.replace(/\([^)]*\)/g, ' ')
  return base
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
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

    // 1. Aggregate the latest haul date per MC number from this batch, and
    //    separately per carrier NAME for loads whose primary carrier has no MC
    //    in Brokerware (some LTL / rail / warehouse carriers are set up without
    //    one). Those used to be skipped entirely, so their "last hauled" never
    //    moved no matter how many loads they ran.
    const latestByMc = new Map<string, string>()
    const latestByName = new Map<string, string>()
    let loadsWithoutMc = 0
    for (const load of loads) {
      const carriers = load.carriers ?? []
      const primary =
        carriers.find((c) => c.isPrimary === true) ?? carriers[0] ?? null
      const iso = loadDate(load)
      if (!iso) continue
      const mc = normalizeMc(primary?.carrierMCNumber)
      if (mc) {
        const prev = latestByMc.get(mc)
        if (!prev || iso > prev) latestByMc.set(mc, iso)
        continue
      }
      loadsWithoutMc++
      const key = nameKey(primary?.carrierName)
      if (!key) continue
      const prev = latestByName.get(key)
      if (!prev || iso > prev) latestByName.set(key, iso)
    }

    if (latestByMc.size === 0 && latestByName.size === 0) {
      return NextResponse.json({
        loadsReceived: loads.length,
        loadsWithoutMc,
        mcMatched: 0,
        nameMatched: 0,
        carriersUpdated: 0,
      })
    }

    // 2. Page through carriers and build two indexes: digits-only MC (formatting
    //    varies, so both sides are normalized in memory) and name key, from the
    //    raw Brokerware name plus legal / DBA names.
    type Entry = { id: string; last: string | null }
    const carrierByMc = new Map<string, Entry[]>()
    const carrierByName = new Map<string, Entry[]>()
    const add = (map: Map<string, Entry[]>, key: string, entry: Entry) => {
      if (!key) return
      const list = map.get(key)
      if (!list) map.set(key, [entry])
      else if (!list.some((e) => e.id === entry.id)) list.push(entry)
    }
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from('carriers')
        .select('id, mc_number, last_hauled_at, brokerware_raw_name, legal_name, dba_name')
        .range(from, from + PAGE - 1)
      if (error) throw error
      const rows = data ?? []
      for (const r of rows as any[]) {
        const entry: Entry = { id: r.id as string, last: (r.last_hauled_at as string) ?? null }
        add(carrierByMc, normalizeMc(r.mc_number), entry)
        add(carrierByName, nameKey(r.brokerware_raw_name), entry)
        add(carrierByName, nameKey(r.legal_name), entry)
        add(carrierByName, nameKey(r.dba_name), entry)
      }
      if (rows.length < PAGE) break
    }

    // 3. Collect forward-only updates (only when the batch date is newer).
    const updates = new Map<string, string>()
    const consider = (carriers: Entry[] | undefined, iso: string): boolean => {
      if (!carriers || carriers.length === 0) return false
      for (const c of carriers) {
        if (!c.last || iso > c.last) {
          const prev = updates.get(c.id)
          if (!prev || iso > prev) updates.set(c.id, iso)
        }
      }
      return true
    }
    let mcMatched = 0
    for (const [mc, iso] of Array.from(latestByMc.entries())) {
      if (consider(carrierByMc.get(mc), iso)) mcMatched++
    }
    let nameMatched = 0
    for (const [key, iso] of Array.from(latestByName.entries())) {
      if (consider(carrierByName.get(key), iso)) nameMatched++
    }

    // 4. Apply updates with a small concurrency cap.
    let carriersUpdated = 0
    const CONCURRENCY = 20
    const updateList = Array.from(updates.entries())
    for (let i = 0; i < updateList.length; i += CONCURRENCY) {
      const slice = updateList.slice(i, i + CONCURRENCY)
      await Promise.all(
        slice.map(async ([id, last_hauled_at]) => {
          const { error } = await supabaseAdmin
            .from('carriers')
            .update({ last_hauled_at } as any)
            .eq('id', id)
          if (!error) carriersUpdated++
          else console.error(`last_hauled_at update failed for ${id}:`, error)
        })
      )
    }

    // 5. Store the full load records (upsert by load_id) so payment vetting can
    //    cross-check invoices locally without extra TMS calls. Only fires when
    //    the batch includes full load objects (has loadId); the reduced haul
    //    payload is ignored here.
    let loadsStored = 0
    const loadRows = loads.map(toLoadRow).filter(Boolean) as Record<string, any>[]
    // De-dupe by load_id (a batch can repeat a load); keep the last.
    const byId = new Map<number, Record<string, any>>()
    for (const r of loadRows) byId.set(r.load_id, r)
    const dedupedRows = Array.from(byId.values())
    const CHUNK = 500
    for (let i = 0; i < dedupedRows.length; i += CHUNK) {
      const slice = dedupedRows.slice(i, i + CHUNK)
      const { error } = await (supabaseAdmin as any)
        .from('loads')
        .upsert(slice as any, { onConflict: 'load_id' })
      if (!error) loadsStored += slice.length
      else console.error('loads upsert failed:', error.message)
    }

    return NextResponse.json({
      loadsReceived: loads.length,
      loadsWithoutMc,
      distinctMc: latestByMc.size,
      mcMatched,
      distinctNames: latestByName.size,
      nameMatched,
      carriersUpdated,
      loadsStored,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
