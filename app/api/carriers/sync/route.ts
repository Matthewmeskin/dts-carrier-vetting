import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { TablesInsert } from '@/lib/database.types'
import { parseCarrierAndFactor } from '@/lib/carrierName'
import { normalizeEntityName } from '@/lib/sosNormalize'
import { isBrokerwareDisabled } from '@/lib/revet'
import { logCarrierEvents } from '@/lib/auditLog'

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
    // Factor label (from the "Carrier/Factor" name) keyed by DOT, plus the set of
    // distinct factors to upsert into the deduped registry.
    const factorByDot = new Map<string, string>() // dot -> normalized factor key
    const factorLabelByNorm = new Map<string, string>() // norm -> display label
    const now = new Date().toISOString()

    for (const c of list) {
      // Skip non-transport / placeholder accounts entirely — not vettable.
      if (isNonCarrier(s(c.carrierName))) continue

      // Brokerware stores factored carriers as "Carrier Name/Factor Name".
      const rawName = s(c.carrierName)
      const { carrierName, factorName } = parseCarrierAndFactor(rawName)

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
        // Store the clean carrier name; keep the raw "Carrier/Factor" string so
        // the parse is non-destructive.
        legal_name: carrierName || rawName,
        brokerware_raw_name: rawName,
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

      if (factorName) {
        const norm = normalizeEntityName(factorName)
        if (norm) {
          factorByDot.set(dot, norm)
          if (!factorLabelByNorm.has(norm)) factorLabelByNorm.set(norm, factorName)
        }
      }
    }

    // Upsert the deduped factor registry and resolve each factor's id so we can
    // link carriers. Only name/normalized_name are touched — approval state and
    // any SOS data on an existing factor are preserved.
    const factorIdByNorm = new Map<string, string>()
    if (factorLabelByNorm.size > 0) {
      const factorRows: TablesInsert<'factors'>[] = Array.from(
        factorLabelByNorm.entries()
      ).map(([normalized_name, name]) => ({ name, normalized_name }))
      const { error: fErr } = await supabaseAdmin
        .from('factors')
        .upsert(factorRows, { onConflict: 'normalized_name', ignoreDuplicates: true })
      if (fErr) throw fErr
      const { data: fRows } = await supabaseAdmin
        .from('factors')
        .select('id, normalized_name, merged_into')
        .in('normalized_name', Array.from(factorLabelByNorm.keys()))
      for (const f of fRows ?? []) {
        // If this spelling was merged into a canonical factor, link carriers to
        // the canonical one so variants collapse and stay collapsed on re-sync.
        factorIdByNorm.set(
          (f as any).normalized_name,
          (f as any).merged_into ?? (f as any).id
        )
      }
      // Attach factor_id to each carrier row we're about to upsert.
      for (const [dot, norm] of Array.from(factorByDot.entries())) {
        const row = byDot.get(dot)
        const fid = factorIdByNorm.get(norm)
        if (row && fid) (row as any).factor_id = fid
      }
    }

    const rows = Array.from(byDot.values())

    // Detect Brokerware disable/enable transitions so we can (a) stamp
    // `brokerware_disabled_at` with the date a carrier actually went disabled
    // (not the last sync), and (b) log an audit event. Load the prior status +
    // disabled-at for the DOTs in this batch, then set each row's disabled_at:
    //   • newly disabled  → stamp now + log a "Disabled in Brokerware" event
    //   • still disabled   → preserve the original disabled_at (don't reset it)
    //   • active/re-enabled → clear disabled_at (+ log a re-enable event)
    const transitionEvents: Parameters<typeof logCarrierEvents>[0] = []
    {
      const allDots = rows.map((r) => r.dot_number).filter(Boolean) as string[]
      const prevByDot = new Map<
        string,
        { brokerware_status: string | null; brokerware_disabled_at: string | null }
      >()
      for (let i = 0; i < allDots.length; i += CHUNK) {
        const { data } = await supabaseAdmin
          .from('carriers')
          .select('dot_number, brokerware_status, brokerware_disabled_at')
          .in('dot_number', allDots.slice(i, i + CHUNK))
        for (const c of data ?? []) {
          prevByDot.set(String((c as any).dot_number), {
            brokerware_status: (c as any).brokerware_status ?? null,
            brokerware_disabled_at: (c as any).brokerware_disabled_at ?? null,
          })
        }
      }
      for (const row of rows) {
        const dot = row.dot_number as string
        const nowDisabled = isBrokerwareDisabled(row.brokerware_status)
        const prev = prevByDot.get(dot)
        const wasDisabled = prev ? isBrokerwareDisabled(prev.brokerware_status) : false
        if (nowDisabled) {
          if (wasDisabled && prev?.brokerware_disabled_at) {
            // Already disabled — keep the original transition date.
            ;(row as any).brokerware_disabled_at = prev.brokerware_disabled_at
          } else {
            ;(row as any).brokerware_disabled_at = now
            // Only log a transition for a carrier we already knew as active;
            // brand-new carriers imported already-disabled aren't a state change.
            if (prev && !wasDisabled) {
              transitionEvents.push({
                dot,
                type: 'status_change',
                summary: `Disabled in Brokerware (status: ${row.brokerware_status})`,
                detail: {
                  brokerware_status: row.brokerware_status,
                  previous_status: prev.brokerware_status,
                  disabled: true,
                },
                actor: 'brokerware-sync',
              })
            }
          }
        } else {
          // Active now — clear any prior disabled stamp and note a re-enable.
          ;(row as any).brokerware_disabled_at = null
          if (wasDisabled) {
            transitionEvents.push({
              dot,
              type: 'status_change',
              summary: `Re-enabled in Brokerware (status: ${row.brokerware_status})`,
              detail: {
                brokerware_status: row.brokerware_status,
                previous_status: prev?.brokerware_status ?? null,
                disabled: false,
              },
              actor: 'brokerware-sync',
            })
          }
        }
      }
    }

    let upserted = 0
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      const { error } = await supabaseAdmin
        .from('carriers')
        .upsert(chunk, { onConflict: 'dot_number' })
      if (error) throw error
      upserted += chunk.length
    }

    // Record disable/enable transitions in the audit log (best-effort).
    if (transitionEvents.length > 0) {
      await logCarrierEvents(transitionEvents)
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
