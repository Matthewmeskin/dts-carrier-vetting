import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { TablesUpdate } from '@/lib/database.types'
import { REVET_INTERVAL_OPTIONS } from '@/lib/revet'
import { logCarrierEvent } from '@/lib/auditLog'
import { getSessionUser } from '@/lib/authServer'
import {
  APPROVING_STATUSES,
  requiredApprovalLevel,
  roleCanSetStatus,
  ROLE_LABEL,
  ROLE_RANK,
  type ApprovalLevel,
} from '@/lib/roles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_STATUSES = [
  'Approved',
  'Exception Approved',
  'Declined',
  'Pending Review',
]

export async function PATCH(
  request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const dot = params.dot
    const body = await request.json()
    const {
      carrier_status,
      do_not_use,
      do_not_use_reason,
      revet_interval_days,
      is_intrastate,
      revet_due_override,
    } = body ?? {}

    // A manually-set re-vet due date (YYYY-MM-DD), or null to clear it.
    if (
      revet_due_override !== undefined &&
      revet_due_override !== null &&
      !/^\d{4}-\d{2}-\d{2}$/.test(String(revet_due_override))
    ) {
      return NextResponse.json(
        { error: `Invalid revet_due_override: ${revet_due_override}` },
        { status: 400 }
      )
    }

    if (carrier_status !== undefined && !ALLOWED_STATUSES.includes(carrier_status)) {
      return NextResponse.json(
        { error: `Invalid carrier_status: ${carrier_status}` },
        { status: 400 }
      )
    }

    if (
      revet_interval_days !== undefined &&
      !REVET_INTERVAL_OPTIONS.includes(revet_interval_days)
    ) {
      return NextResponse.json(
        { error: `Invalid revet_interval_days: ${revet_interval_days}` },
        { status: 400 }
      )
    }

    // ── Role gate ──────────────────────────────────────────────────────────
    // Approving a carrier that tripped a gate requires a high-enough role
    // (§9.4). Restrictive statuses (Decline/Suspend/Do Not Use/Pending) and
    // clean approvals are open to any signed-in user. Only enforced once auth
    // is turned on.
    const authOn = process.env.AUTH_ENABLED !== 'false'
    const user = await getSessionUser()
    if (authOn && !user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }
    let requiredLevel: ApprovalLevel = 'none'
    if (user && carrier_status !== undefined && APPROVING_STATUSES.includes(carrier_status)) {
      const { data: carrierRow } = await supabaseAdmin
        .from('carriers')
        .select('safety_rating')
        .eq('dot_number', dot)
        .maybeSingle()
      const { data: scoreRow } = await (supabaseAdmin as any)
        .from('carrier_scores')
        .select('approval_level')
        .eq('dot_number', dot)
        .order('release_month', { ascending: false })
        .order('upload_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      requiredLevel = requiredApprovalLevel(
        scoreRow?.approval_level,
        (carrierRow as any)?.safety_rating
      )
      if (!roleCanSetStatus(user.role, carrier_status, requiredLevel)) {
        return NextResponse.json(
          {
            error: `This carrier requires ${ROLE_LABEL[requiredLevel as 'manager' | 'director'] ?? requiredLevel}-level approval. Your role (${ROLE_LABEL[user.role]}) can't approve it.`,
            requiredLevel,
          },
          { status: 403 }
        )
      }
    }

    // Marking a carrier intrastate downgrades a real hard stop (no interstate
    // authority), so require Manager+ — never a Staff user.
    if (is_intrastate !== undefined && authOn && user && ROLE_RANK[user.role] < ROLE_RANK.manager) {
      return NextResponse.json(
        { error: `Marking a carrier intrastate requires Manager or Director. Your role is ${ROLE_LABEL[user.role]}.` },
        { status: 403 }
      )
    }

    const updates: TablesUpdate<'carriers'> = {}
    if (carrier_status !== undefined) updates.carrier_status = carrier_status
    if (do_not_use !== undefined) updates.do_not_use = do_not_use
    if (do_not_use_reason !== undefined) updates.do_not_use_reason = do_not_use_reason
    if (revet_interval_days !== undefined)
      updates.revet_interval_days = revet_interval_days
    if (is_intrastate !== undefined) (updates as any).is_intrastate = !!is_intrastate
    if (revet_due_override !== undefined)
      (updates as any).revet_due_override = revet_due_override || null

    const { data, error } = await supabaseAdmin
      .from('carriers')
      .update(updates)
      .eq('dot_number', dot)
      .select('*')
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })
    }

    // Audit trail — record what changed.
    const parts: string[] = []
    if (carrier_status !== undefined) parts.push(`status → ${carrier_status}`)
    if (do_not_use !== undefined) parts.push(`do-not-use → ${do_not_use ? 'yes' : 'no'}`)
    if (revet_interval_days !== undefined)
      parts.push(`re-vet interval → ${revet_interval_days}d`)
    if (revet_due_override !== undefined)
      parts.push(
        revet_due_override
          ? `re-vet due date set → ${revet_due_override}`
          : 're-vet due date override cleared'
      )
    if (is_intrastate !== undefined)
      parts.push(`intrastate designation → ${is_intrastate ? 'ON (interstate authority not required)' : 'OFF'}`)
    if (parts.length > 0) {
      await logCarrierEvent({
        dot,
        carrierId: (data as any).id ?? null,
        type: 'status_change',
        summary: `Carrier updated: ${parts.join(', ')}.`,
        detail: { carrier_status, do_not_use, do_not_use_reason, revet_interval_days, requiredLevel },
        actor: user ? `${user.email} (${ROLE_LABEL[user.role]})` : 'DTS',
      })
    }

    return NextResponse.json({ carrier: data })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
