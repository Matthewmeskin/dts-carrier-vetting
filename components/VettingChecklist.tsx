'use client'

import { useMemo, useRef, useState } from 'react'
import { InsuranceRecord, ScoreRecord, VettingRecord } from '@/lib/types'
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
  vettingRecords,
  onSaved,
  carrierStatus,
  onCarrierStatusChange,
  revetIntervalDays,
  onRevetIntervalChange,
  revet,
  revetDisabled,
  statusSaving,
}: {
  dot: string
  carrierName?: string | null
  safetyRating?: string | null
  insurance?: InsuranceRecord | null
  score?: ScoreRecord | null
  vettingRecords: VettingRecord[]
  onSaved?: () => void | Promise<void>
  carrierStatus: string | null
  onCarrierStatusChange: (status: string) => void
  revetIntervalDays: number | null
  onRevetIntervalChange: (days: number) => void
  revet: RevetStatus
  revetDisabled?: boolean
  statusSaving?: boolean
}) {
  const [tab, setTab] = useState<'active' | 'history'>('active')

  const latest = vettingRecords[0]
  const autoInputs = useMemo<ChecklistAutoInputs>(
    () => ({ safetyRating, insurance, score }),
    [safetyRating, insurance, score]
  )
  const [vettingType, setVettingType] = useState(
    latest?.vetting_type || 'initial'
  )
  const [checklist, setChecklist] = useState<VettingChecklistType>(() =>
    hydrateChecklist(latest, autoInputs)
  )
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
                <Select
                  label="Carrier status (vetting decision)"
                  value={carrierStatus ?? 'Pending Review'}
                  disabled={statusSaving}
                  onChange={(e) => onCarrierStatusChange(e.target.value)}
                >
                  {CARRIER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
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
