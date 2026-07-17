'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { InsuranceRecord, ScoreRecord, SosRecord, VettingRecord } from '@/lib/types'
import {
  createDefaultChecklist,
  checklistCompletionPercent,
  CHECKLIST_CATEGORIES,
  attachAutoEvidence,
  applyAutoCompletion,
  autoSummary,
  type ChecklistAutoInputs,
  type VettingChecklist as VettingChecklistType,
  type ChecklistStep,
} from '@/lib/vettingChecklist'
import { Card, CardHeader, CardBody } from './ui/Card'
import { Button } from './ui/Button'
import { Input, Select, Textarea } from './ui/Input'
import { Badge, carrierStatusTone, type BadgeTone } from './ui/Badge'
import { Spinner } from './ui/Spinner'
import { ExceptionNoteComposer } from './ExceptionNoteComposer'
import { cn, formatDateTime } from '@/lib/utils'
import { REVET_INTERVAL_OPTIONS, type RevetStatus, type RevetState } from '@/lib/revet'
import {
  APPROVING_STATUSES,
  requiredApprovalLevel,
  roleCanApprove,
  ROLE_LABEL,
  type Role,
  type ApprovalLevel,
} from '@/lib/roles'

const VETTING_TYPES = [
  { value: 'initial', label: 'Initial' },
  { value: 'monthly_review', label: 'Monthly Review' },
  { value: 'revetting', label: 'Re-vetting' },
  { value: 'exception', label: 'Exception' },
]

// The single carrier status = the vetting decision.
const CARRIER_STATUSES = [
  'Pending Review',
  'Approved',
  'Approved with Restrictions',
  'Exception Approved',
  'Declined',
  'Suspended',
  'Do Not Use',
]

const REVET_TONE: Record<RevetState, BadgeTone> = {
  overdue: 'red',
  due_soon: 'amber',
  ok: 'green',
  unknown: 'gray',
}

const ATTACH_TYPES = [
  { value: 'exception_note', label: 'Exception Note' },
  { value: 'broker_carrier_agreement', label: 'Broker-Carrier Agreement' },
  { value: 'w9', label: 'W-9' },
  { value: 'insurance_cert', label: 'Insurance Certificate' },
  { value: 'noa', label: 'Notice of Assignment (NOA)' },
  { value: 'osint_report', label: 'OSINT Report' },
  { value: 'fmcsa_screenshot', label: 'FMCSA Screenshot' },
  { value: 'other', label: 'Other' },
]

function hydrateChecklist(
  record: VettingRecord | undefined,
  autoInputs: ChecklistAutoInputs
): VettingChecklistType {
  // Always attach the RMIS/Bluewire evidence so it shows on every step.
  const base = attachAutoEvidence(createDefaultChecklist(), autoInputs)
  if (!record?.checklist) {
    // Fresh checklist — pre-check the steps the data already clears.
    return applyAutoCompletion(base)
  }
  const saved = record.checklist as Partial<VettingChecklistType>
  if (!saved.steps) return applyAutoCompletion(base)
  // Merge a human's saved completion/notes onto the canonical step definitions.
  const byId = new Map(saved.steps.map((s) => [s.id, s]))
  base.steps = base.steps.map((s) => {
    const prev = byId.get(s.id)
    return prev
      ? {
          ...s,
          completed: !!prev.completed,
          notes: prev.notes ?? '',
          source: prev.source ?? (prev.completed ? 'manual' : s.source),
        }
      : s
  })
  base.exceptionNote = saved.exceptionNote ?? record.exception_note ?? ''
  return base
}

export function VettingChecklist({
  dot,
  carrierName,
  safetyRating,
  insurance,
  score,
  sos,
  documentTypes,
  vettingRecords,
  onSaved,
  carrierStatus,
  onCarrierStatusChange,
  revetIntervalDays,
  onRevetIntervalChange,
  revet,
  revetDisabled,
  statusSaving,
  statusError,
}: {
  dot: string
  carrierName?: string | null
  safetyRating?: string | null
  insurance?: InsuranceRecord | null
  score?: ScoreRecord | null
  sos?: SosRecord | null
  documentTypes?: string[] | null
  vettingRecords: VettingRecord[]
  onSaved?: () => void | Promise<void>
  carrierStatus: string | null
  onCarrierStatusChange: (status: string) => void
  revetIntervalDays: number | null
  onRevetIntervalChange: (days: number) => void
  revet: RevetStatus
  revetDisabled?: boolean
  statusSaving?: boolean
  statusError?: string | null
}) {
  const [tab, setTab] = useState<'active' | 'history'>('active')

  // Signed-in user's role — gates which approving statuses they may set.
  const [role, setRole] = useState<Role | null>(null)
  // Signed-in user's identity, used to auto-fill the exception-note reviewer/approver.
  const [me, setMe] = useState<{ name: string; role: Role } | null>(null)
  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.user?.role) {
          setRole(d.user.role)
          setMe({ name: d.user.fullName || d.user.email || '', role: d.user.role })
        }
      })
      .catch(() => {})
  }, [])
  const requiredLevel: ApprovalLevel = requiredApprovalLevel(
    (score as any)?.approval_level,
    safetyRating
  )
  // Only block when we actually know the role (auth on); null role = auth off.
  const blockedApproval =
    !!role && requiredLevel !== 'none' && !roleCanApprove(role, requiredLevel)

  const latest = vettingRecords[0]
  const autoInputs = useMemo<ChecklistAutoInputs>(
    () => ({ safetyRating, insurance, score, sos, documentTypes }),
    [safetyRating, insurance, score, sos, documentTypes]
  )
  const [vettingType, setVettingType] = useState(
    latest?.vetting_type || 'initial'
  )
  const [checklist, setChecklist] = useState<VettingChecklistType>(() =>
    hydrateChecklist(latest, autoInputs)
  )

  // Re-apply auto-evaluation when the underlying data changes (e.g. a document
  // is uploaded to the portal after the page loaded): refresh each step's
  // evidence and re-check the ones a human hasn't manually overridden.
  useEffect(() => {
    setChecklist((prev) => {
      const evaluated = attachAutoEvidence(prev, autoInputs)
      return {
        ...evaluated,
        steps: evaluated.steps.map((s) =>
          s.source === 'manual'
            ? s
            : s.autoStatus === 'pass'
              ? { ...s, completed: true, source: 'auto' }
              : s.autoStatus === 'fail'
                ? { ...s, completed: false, source: 'auto' }
                : s
        ),
      }
    })
  }, [autoInputs])
  const [internalNotes, setInternalNotes] = useState(
    latest?.internal_notes || ''
  )
  const [reviewedBy, setReviewedBy] = useState(latest?.reviewed_by || '')
  const [approvedBy, setApprovedBy] = useState(latest?.approved_by || '')
  const [exceptionNote, setExceptionNote] = useState(
    latest?.exception_note || ''
  )
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [folderUrl, setFolderUrl] = useState<string | null>(
    latest?.google_drive_folder_url || null
  )
  const fileRef = useRef<HTMLInputElement>(null)
  const [attachFile, setAttachFile] = useState<File | null>(null)
  const [attachType, setAttachType] = useState('exception_note')

  const percent = checklistCompletionPercent(checklist)
  const summary = useMemo(() => autoSummary(checklist), [checklist])

  // Build a defensible, mostly-factual exception memo: auto-fill the objective
  // record (who/when, what was reviewed, the issues the checks raised, a data
  // snapshot) and leave the judgment sections (mitigating factors, controls,
  // scope) blank for the reviewer to write in their own words.
  function buildExceptionPrefill(): string {
    const today = new Date().toLocaleDateString('en-US')
    const roleLabel = me ? ROLE_LABEL[me.role] ?? me.role : ''
    const reviewer = me?.name ? `${me.name} (${roleLabel})` : '[YOUR NAME / ROLE]'
    const approver = me?.name ? `${me.name}, ${roleLabel}` : '[Name, Title]'
    const fmt = (d?: string | null) =>
      d ? new Date(d).toLocaleDateString('en-US', { timeZone: 'UTC' }) : null
    const money = (n?: number | null) =>
      n != null ? `$${Number(n).toLocaleString('en-US')}` : null

    const steps = checklist.steps as any[]
    const failing = steps.filter((s) => s.required && s.autoStatus === 'fail')
    const openReview = steps.filter(
      (s) => s.required && !s.completed && s.autoStatus !== 'fail'
    )
    const issueLines = [
      ...failing.map((s) => `- Policy not met: ${s.label} (${s.policyRef})`),
      ...openReview.map((s) => `- Needs human review: ${s.label} (${s.policyRef})`),
    ]
    const issues = issueLines.length
      ? issueLines.join('\n')
      : '[Describe the specific non-hard-stop issue — e.g., "Carrier has 45 days of authority and limited inspection history"]'

    const reviewed: string[] = []
    if (score) {
      const rel = fmt((score as any).release_month)
      const up = fmt((score as any).upload_date)
      reviewed.push(
        `- Bluewire safety scores${rel ? ` (release ${rel})` : ''}${up ? `, uploaded ${up}` : ''}`
      )
    }
    if (insurance) {
      const f = fmt(insurance.fetched_at)
      reviewed.push(`- RMIS insurance & authority data${f ? ` (pulled ${f})` : ''}`)
    }
    if (safetyRating) reviewed.push('- FMCSA safety rating')
    if (sos) reviewed.push('- Secretary of State business registration')
    reviewed.push(
      '- [Add any: direct carrier conversation, OSINT / web search, references, prior load history]'
    )

    const snap: string[] = []
    const authDate = fmt(insurance?.authority_original_date)
    const days = insurance?.authority_days_active
    if (authDate || days != null)
      snap.push(
        `- Operating authority granted${authDate ? ` ${authDate}` : ''}${
          days != null ? ` (${days} days active)` : ''
        }${insurance?.operating_status ? `; status: ${insurance.operating_status}` : ''}`
      )
    if (safetyRating) snap.push(`- FMCSA safety rating: ${safetyRating}`)
    if (insurance?.us_total_inspections != null)
      snap.push(
        `- US inspections: ${insurance.us_total_inspections}` +
          (insurance.us_vehicle_oos_ratio ? `, vehicle OOS ${insurance.us_vehicle_oos_ratio}` : '') +
          (insurance.us_driver_oos_ratio ? `, driver OOS ${insurance.us_driver_oos_ratio}` : '')
      )
    if (insurance?.auto_status) {
      const lim = money(insurance.auto_limit)
      const exp = fmt(insurance.auto_expiration_date)
      snap.push(
        `- Auto liability: ${insurance.auto_status}${lim ? `, limit ${lim}` : ''}${exp ? `, expires ${exp}` : ''}`
      )
    }
    if (insurance?.cargo_status) {
      const lim = money(insurance.cargo_limit)
      const exp = fmt(insurance.cargo_expiration_date)
      snap.push(
        `- Cargo: ${insurance.cargo_status}${lim ? `, limit ${lim}` : ''}${exp ? `, expires ${exp}` : ''}`
      )
    }
    if (score) {
      const gap = (score as any).gap_score
      const flagged = ((score as any).flagged_scores as string[] | null) || []
      snap.push(
        `- Bluewire GAP score: ${gap != null ? gap : '—'}; flagged categories: ${
          flagged.length ? flagged.join(', ') : 'none'
        }`
      )
    }
    const snapshot = snap.length ? snap.join('\n') : '- [No RMIS / Bluewire snapshot on file]'

    const typeLabel = VETTING_TYPES.find((t) => t.value === vettingType)?.label ?? vettingType

    return [
      'CARRIER EXCEPTION / REASONABLE-CARE MEMO',
      '',
      `Carrier: ${carrierName || '[CARRIER NAME]'}, USDOT ${dot}`,
      `Review date: ${today}`,
      `Reviewed by: ${reviewer}`,
      `Vetting type: ${typeLabel}`,
      '',
      'ISSUE(S) IDENTIFIED',
      issues,
      '',
      'INFORMATION REVIEWED',
      reviewed.join('\n'),
      '',
      'CARRIER SNAPSHOT (as of review date)',
      snapshot,
      '',
      'MITIGATING FACTORS',
      '[Describe why this carrier is still appropriate despite the issue — prior experience, low-risk freight, strong insurance, references, etc. Write this in your own words.]',
      '',
      'OPERATIONAL CONTROLS REQUIRED',
      '[List controls — one-load limit, live ELD tracking, direct insurance verification, pickup verification, etc.]',
      '',
      'APPROVAL',
      'Approved for: [Scope — one load / specific lane / specific date range]',
      `Approved by: ${approver}`,
      `Date: ${today}`,
    ].join('\n')
  }

  const showException = useMemo(() => {
    const anyRequiredIncomplete = checklist.steps.some(
      (s) => s.required && !s.completed
    )
    const exceptionStepChecked = checklist.steps.find(
      (s) => s.id === 'exception_note'
    )?.completed
    return anyRequiredIncomplete || !!exceptionStepChecked
  }, [checklist])

  function updateStep(id: string, patch: Partial<ChecklistStep>) {
    // A human toggling the box overrides any auto state — record that.
    const withSource =
      'completed' in patch ? { ...patch, source: 'manual' as const } : patch
    setChecklist((c) => ({
      ...c,
      steps: c.steps.map((s) => (s.id === id ? { ...s, ...withSource } : s)),
    }))
  }

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/vetting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dotNumber: dot,
          vettingType,
          // The single carrier status is the vetting decision/outcome.
          vettingStatus: carrierStatus ?? 'Pending Review',
          checklist: { ...checklist, exceptionNote },
          exceptionNote,
          internalNotes,
          reviewedBy,
          approvedBy,
          approvalLevelRequired: showException ? 'exception' : 'standard',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      if (data?.folder?.webViewLink) setFolderUrl(data.folder.webViewLink)

      // Attach the selected document to this review, if any.
      if (attachFile && data?.id) {
        try {
          const fd = new FormData()
          fd.append('file', attachFile)
          fd.append('documentType', attachType)
          fd.append('uploadedBy', reviewedBy)
          fd.append('vettingRecordId', String(data.id))
          const upRes = await fetch(`/api/carriers/${dot}/documents`, {
            method: 'POST',
            body: fd,
          })
          if (!upRes.ok) {
            const upErr = await upRes.json().catch(() => ({}))
            throw new Error(upErr.error || 'Document upload failed')
          }
          setAttachFile(null)
          if (fileRef.current) fileRef.current.value = ''
          setMessage('Vetting record and document saved.')
        } catch (upErr) {
          setMessage(
            `Vetting saved, but document upload failed: ${
              upErr instanceof Error ? upErr.message : 'error'
            }`
          )
        }
      } else {
        setMessage('Vetting record saved.')
      }
      await onSaved?.()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Vetting Workspace"
        action={
          <div className="flex gap-1 rounded-md bg-gray-100 p-0.5 text-xs">
            <button
              onClick={() => setTab('active')}
              className={cn(
                'rounded px-3 py-1 font-medium',
                tab === 'active'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500'
              )}
            >
              Active Vetting
            </button>
            <button
              onClick={() => setTab('history')}
              className={cn(
                'rounded px-3 py-1 font-medium',
                tab === 'history'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500'
              )}
            >
              History ({vettingRecords.length})
            </button>
          </div>
        }
      />
      <CardBody>
        {tab === 'active' ? (
          <div className="space-y-4">
            {/* Decision bar — the single status + re-vet timer + reviewers + save */}
            <div className="rounded-lg border border-dts-blue/30 bg-blue-50/40 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <Select
                    label="Carrier status (vetting decision)"
                    value={carrierStatus ?? 'Pending Review'}
                    disabled={statusSaving}
                    onChange={(e) => onCarrierStatusChange(e.target.value)}
                  >
                    {CARRIER_STATUSES.map((s) => {
                      const gated = blockedApproval && APPROVING_STATUSES.includes(s)
                      return (
                        <option key={s} value={s} disabled={gated}>
                          {s}
                          {gated ? ` — needs ${ROLE_LABEL[requiredLevel as 'manager' | 'director']}` : ''}
                        </option>
                      )
                    })}
                  </Select>
                  {blockedApproval && (
                    <p className="mt-1 text-xs text-amber-700">
                      This carrier needs{' '}
                      <span className="font-semibold">
                        {ROLE_LABEL[requiredLevel as 'manager' | 'director']}
                      </span>
                      -level approval — your role ({role ? ROLE_LABEL[role] : '—'}) can set a
                      hold/decline but not approve it.
                    </p>
                  )}
                  {statusError && (
                    <p className="mt-1 text-xs text-red-700">{statusError}</p>
                  )}
                </div>
                <div>
                  <Select
                    label="Re-vetting cadence"
                    value={String(revetIntervalDays ?? 120)}
                    disabled={statusSaving || revetDisabled}
                    onChange={(e) => onRevetIntervalChange(Number(e.target.value))}
                  >
                    {REVET_INTERVAL_OPTIONS.map((d) => (
                      <option key={d} value={d}>
                        Every {d} days
                      </option>
                    ))}
                  </Select>
                  <div className="mt-1.5">
                    {revetDisabled ? (
                      <span className="text-xs text-gray-500">
                        Disabled — re-vetting not required
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <Badge tone={REVET_TONE[revet.state]}>{revet.label}</Badge>
                        {revet.dueDate && (
                          <span className="text-xs text-gray-500">
                            due {revet.dueDate.toLocaleDateString()}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <Input
                  label="Reviewed by"
                  value={reviewedBy}
                  onChange={(e) => setReviewedBy(e.target.value)}
                  placeholder="Name / role"
                />
                <Input
                  label="Approved by"
                  value={approvedBy}
                  onChange={(e) => setApprovedBy(e.target.value)}
                  placeholder="Name, title"
                />
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Select
                  label="Attach document (optional)"
                  value={attachType}
                  onChange={(e) => setAttachType(e.target.value)}
                >
                  {ATTACH_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    File
                  </label>
                  <input
                    ref={fileRef}
                    type="file"
                    onChange={(e) => setAttachFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-dts-blue file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-[#00547f]"
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-dts-blue/20 pt-3">
                <Button onClick={save} disabled={saving}>
                  {saving ? <Spinner size={14} className="text-white" /> : null}
                  {saving ? 'Saving…' : 'Save vetting record'}
                </Button>
                {folderUrl && (
                  <a
                    href={folderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-dts-blue hover:underline"
                  >
                    Open Drive folder →
                  </a>
                )}
                {message && (
                  <span className="text-sm text-gray-600">{message}</span>
                )}
                <span className="ml-auto text-xs text-gray-500">
                  Setting a final status records the vetting &amp; starts the
                  re-vet clock.
                </span>
              </div>
            </div>

            {showException && (
              <ExceptionNoteComposer
                value={exceptionNote}
                onChange={setExceptionNote}
                carrierName={carrierName}
                dotNumber={dot}
                onBuildPrefill={buildExceptionPrefill}
              />
            )}

            <Textarea
              label="Internal notes"
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={3}
              placeholder="Internal notes about this vetting…"
            />

            <div className="flex flex-wrap items-end gap-3">
              <div className="w-56">
                <Select
                  label="Vetting type"
                  value={vettingType}
                  onChange={(e) => setVettingType(e.target.value)}
                >
                  {VETTING_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex-1">
                <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                  <span>Required steps complete</span>
                  <span className="font-semibold">{percent}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      percent === 100 ? 'bg-green-500' : 'bg-dts-blue'
                    )}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              <span className="font-medium text-gray-700">
                Auto-evaluated from RMIS &amp; Bluewire:
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                {summary.autoVerified} auto-verified
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                {summary.failed} failed policy
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-gray-300" />
                {summary.manual} need human review
              </span>
              <span className="ml-auto text-gray-400">
                Auto-checked items can be overridden.
              </span>
            </div>

            <div className="space-y-5">
              {CHECKLIST_CATEGORIES.map((cat) => {
                const catSteps = checklist.steps.filter(
                  (s) => s.category === cat.key
                )
                if (catSteps.length === 0) return null
                const catDone = catSteps.filter((s) => s.completed).length
                return (
                  <div key={cat.key} className="space-y-2">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-gray-100 pb-1">
                      <h4 className="text-sm font-bold uppercase tracking-wide text-dts-blue">
                        {cat.label}
                      </h4>
                      <span className="text-xs text-gray-400">
                        {cat.description}
                      </span>
                      <span className="ml-auto text-xs font-medium text-gray-500">
                        {catDone}/{catSteps.length}
                      </span>
                    </div>
                    {catSteps.map((s) => {
                      const open = expanded[s.id]
                      return (
                        <div
                          key={s.id}
                          className={cn(
                            'rounded-md border px-3 py-2.5',
                            s.completed
                              ? 'border-green-200 bg-green-50/50'
                              : 'border-gray-200'
                          )}
                        >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={s.completed}
                        onChange={(e) =>
                          updateStep(s.id, { completed: e.target.checked })
                        }
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-dts-blue focus:ring-dts-blue"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">
                            {s.label}
                          </span>
                          <Badge tone="gray">{s.policyRef}</Badge>
                          {s.required ? (
                            <Badge tone="maroon">Required</Badge>
                          ) : (
                            <Badge tone="blue">Optional</Badge>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded((x) => ({ ...x, [s.id]: !x[s.id] }))
                            }
                            className="ml-auto text-xs text-dts-blue hover:underline"
                          >
                            {open ? 'Hide details' : 'Details'}
                          </button>
                        </div>
                        {(s.autoStatus || s.evidence) && (
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            {s.autoStatus === 'pass' && (
                              <Badge tone={s.source === 'manual' ? 'amber' : 'green'}>
                                {s.source === 'manual'
                                  ? 'Manual override'
                                  : 'Auto-verified'}
                              </Badge>
                            )}
                            {s.autoStatus === 'fail' && (
                              <Badge tone={s.completed ? 'amber' : 'red'}>
                                {s.completed
                                  ? 'Override — accepted despite policy'
                                  : 'Failed policy'}
                              </Badge>
                            )}
                            {s.evidence && (
                              <span className="text-xs text-gray-500">
                                {s.evidence}
                              </span>
                            )}
                          </div>
                        )}
                        {open && (
                          <>
                            <p className="mt-1.5 text-xs text-gray-600">
                              {s.description}
                            </p>
                            <Textarea
                              value={s.notes}
                              onChange={(e) =>
                                updateStep(s.id, { notes: e.target.value })
                              }
                              rows={2}
                              placeholder="Notes for this step…"
                              className="mt-2 text-xs"
                            />
                          </>
                        )}
                      </div>
                    </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>


          </div>
        ) : (
          <HistoryTab records={vettingRecords} />
        )}
      </CardBody>
    </Card>
  )
}

function HistoryTab({ records }: { records: VettingRecord[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  if (records.length === 0) {
    return <p className="text-sm text-gray-500">No prior vetting records.</p>
  }
  return (
    <ol className="space-y-3">
      {records.map((r) => {
        const cl = r.checklist as VettingChecklistType | null
        return (
          <li key={r.id} className="rounded-md border border-gray-200">
            <button
              onClick={() => setOpen((x) => ({ ...x, [r.id]: !x[r.id] }))}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {formatDateTime(r.completed_at || r.created_at)}
                </div>
                <div className="text-xs text-gray-500">
                  {r.vetting_type} · reviewed by {r.reviewed_by || '—'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={carrierStatusTone(r.vetting_status)}>
                  {r.vetting_status || 'in progress'}
                </Badge>
                <span className="text-xs text-gray-400">
                  {open[r.id] ? '▲' : '▼'}
                </span>
              </div>
            </button>
            {open[r.id] && (
              <div className="space-y-3 border-t border-gray-100 px-4 py-3">
                {r.google_drive_folder_url && (
                  <a
                    href={r.google_drive_folder_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-dts-blue hover:underline"
                  >
                    Open Drive folder →
                  </a>
                )}
                {cl?.steps && (
                  <ul className="space-y-1 text-sm">
                    {cl.steps.map((s) => (
                      <li key={s.id} className="flex items-start gap-2">
                        <span
                          className={
                            s.completed ? 'text-green-600' : 'text-gray-300'
                          }
                        >
                          {s.completed ? '✓' : '○'}
                        </span>
                        <span className="text-gray-700">{s.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {r.exception_note && (
                  <div>
                    <div className="text-xs font-semibold text-gray-500">
                      Exception note
                    </div>
                    <pre className="mt-1 whitespace-pre-wrap rounded bg-gray-50 p-3 font-mono text-xs text-gray-700">
                      {r.exception_note}
                    </pre>
                  </div>
                )}
                {r.internal_notes && (
                  <div>
                    <div className="text-xs font-semibold text-gray-500">
                      Internal notes
                    </div>
                    <p className="mt-1 text-sm text-gray-700">
                      {r.internal_notes}
                    </p>
                  </div>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
