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
    let skippedNoDot = 0
    const byDot = new Map<string, TablesInsert<'carriers'>>()

    for (const c of list) {
      const status = s(c.status)
      if (!status || status.toLowerCase() !== 'active') continue
      active++
      const dot = s(c.dot)
      if (!dot) {
        skippedNoDot++
        continue
      }
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
        brokerware_synced_at: new Date().toISOString(),
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

    return NextResponse.json({
      received: list.length,
      active,
      upserted,
      skippedNoDot,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
