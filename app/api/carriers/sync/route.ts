import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { TablesInsert } from '@/lib/database.types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CHUNK = 500

function s(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const t = String(v).trim()
  return t === '' ? null : t
}

// Some Brokerware entries are non-transport / placeholder accounts, not carriers
// we vet (e.g. "(%CC Non-Transport)", "Carrier Placeholder N"). They should
// never be treated as a vettable carrier or flagged as "missing a DOT".
function isNonCarrier(name: string | null): boolean {
  if (!name) return false
  const n = name.toLowerCase()
  return (
    n.includes('non-transport') ||
    n.includes('non transport') ||
    n.includes('placeholder')
  )
}

// Normalize the incoming payload into an array of Brokerware carrier objects.
// Accepts a bare array, a wrapped object ({carriers|data|results}), or a single
// carrier object.
function toList(body: any): any[] {
  if (Array.isArray(body)) return body
  if (Array.isArray(body?.carriers)) return body.carriers
  if (Array.isArray(body?.data)) return body.data
  if (Array.isArray(body?.results)) return body.results
  if (body && typeof body === 'object' && ('dot' in body || 'carrierId' in body)) {
    return [body]
  }
  return []
}

// POST — upsert active carriers from Brokerware/Hyperion into the carriers
// table. Identity fields are refreshed from Brokerware (system of record);
// vetting fields (carrier_status, safety_rating, do_not_use, revet cadence)
// are never overwritten.
export async function POST(request: Request) {
  try {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const list = toList(body)
    if (list.length === 0) {
      return NextResponse.json({ received: 0, active: 0, upserted: 0, skippedNoDot: 0 })
    }

    let active = 0
    let disabled = 0
    const byDot = new Map<string, TablesInsert<'carriers'>>()
    const skipped: TablesInsert<'brokerware_skipped_carriers'>[] = []
    const now = new Date().toISOString()

    for (const c of list) {
      // Skip non-transport / placeholder accounts entirely — not vettable.
      if (isNonCarrier(s(c.carrierName))) continue

      const status = s(c.status)
      const isActive = !!status && status.toLowerCase() === 'active'
      if (isActive) active++
      else disabled++

      const dot = s(c.dot)
      if (!dot) {
        // Only active carriers missing a DOT need review; a disabled carrier
        // without a DOT isn't vettable anyway.
        if (isActive) {
          skipped.push({
            brokerware_carrier_id:
              c.carrierId != null && !isNaN(Number(c.carrierId)) ? Number(c.carrierId) : null,
            carrier_name: s(c.carrierName),
            mc: s(c.mc),
            scac: s(c.scac),
            city: s(c.carrierCity),
            state: s(c.carrierState),
            phone: s(c.carrierPhone),
            email: s(c.carrierContactEmail),
            status,
            reason: 'no_dot',
          })
        }
        continue
      }

      // Save every carrier with a DOT — active and disabled — stamping the raw
      // Brokerware status so disabled carriers are flagged and excluded from
      // vetting downstream.
      byDot.set(dot, {
        dot_number: dot,
        mc_number: s(c.mc),
        legal_name: s(c.carrierName),
        street: s(c.carrierAddress1),
        city: s(c.carrierCity),
        state: s(c.carrierState),
        zip: s(c.carrierZip),
        phone: s(c.carrierPhone),
        email: s(c.carrierContactEmail),
        brokerware_carrier_id:
          c.carrierId != null && !isNaN(Number(c.carrierId)) ? Number(c.carrierId) : null,
        brokerware_status: status,
        brokerware_synced_at: now,
      })
    }

    const rows = Array.from(byDot.values())
    let upserted = 0
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      const { error } = await supabaseAdmin
        .from('carriers')
        .upsert(chunk, { onConflict: 'dot_number' })
      if (error) throw error
      upserted += chunk.length
    }

    // Replace the no-DOT list with this sync's results so it always reflects
    // the latest pull.
    await supabaseAdmin
      .from('brokerware_skipped_carriers')
      .delete()
      .not('id', 'is', null)
    for (let i = 0; i < skipped.length; i += CHUNK) {
      const chunk = skipped.slice(i, i + CHUNK)
      const { error } = await supabaseAdmin
        .from('brokerware_skipped_carriers')
        .insert(chunk)
      if (error) throw error
    }

    return NextResponse.json({
      received: list.length,
      active,
      disabled,
      upserted,
      skippedNoDot: skipped.length,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}

// GET — list the active Brokerware carriers skipped for having no DOT.
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('brokerware_skipped_carriers')
      .select('*')
      .order('carrier_name', { ascending: true })
    if (error) throw error
    return NextResponse.json({ skipped: data ?? [], count: (data ?? []).length })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
