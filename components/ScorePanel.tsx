'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ScoreRecord } from '@/lib/types'
import {
  SCORE_FIELDS,
  scoreFieldPasses,
  MIN_30_THRESHOLD,
  PERFECT_SCORE,
  getApprovalLevelLabel,
  ApprovalLevel,
} from '@/lib/scoringRules'
import { Card, CardHeader, CardBody } from './ui/Card'
import { Badge, BadgeTone } from './ui/Badge'
import { Table, THead, TBody, TR, TH, TD } from './ui/Table'
import { ScoreTrend } from './ScoreTrend'
import { cn, formatDate, formatScore } from '@/lib/utils'

function approvalTone(level?: string | null): BadgeTone {
  switch (level) {
    case 'auto_clear':
      return 'green'
    case 'additional_vetting':
      return 'amber'
    case 'manager_exception':
      return 'amber'
    case 'owner_exception':
      return 'red'
    default:
      return 'gray'
  }
}

function gapColor(gap: number | null | undefined): string {
  if (gap === null || gap === undefined) return 'text-gray-400'
  if (gap >= 65) return 'text-green-700'
  if (gap >= 60) return 'text-amber-600'
  return 'text-red-600'
}

// Short display labels (the full labels used for flagging live in scoringRules).
const SHORT_LABEL: Record<string, string> = {
  crash_score: 'Crash',
  violation_score: 'Violation',
  csa_basics_score: 'CSA Basics',
  driver_oos_score: 'Driver OOS',
  critical_acute_violation_score: 'Critical/Acute Violation',
  new_entrant_score: 'New Entrant',
  mcs_150_score: 'MCS-150',
  safety_rating_score: 'Safety Rating',
  judicial_hellholes_score: 'Judicial Hellholes',
}

function requirementNote(req: string): string {
  if (req === 'min30') return `≥ ${MIN_30_THRESHOLD}`
  if (req === 'perfect') return `= ${PERFECT_SCORE}`
  return 'not considered'
}

// Every scored category, GAP first, for the transposed history grid.
const CATEGORY_ROWS: {
  key: string
  label: string
  kind: 'gap' | 'cat'
  requirement?: string
}[] = [
  { key: 'gap_score', label: 'GAP', kind: 'gap' },
  ...SCORE_FIELDS.map((f) => ({
    key: f.key,
    label: SHORT_LABEL[f.key] ?? f.label,
    kind: 'cat' as const,
    requirement: f.requirement,
  })),
]

// One row per FMCSA release month (newest upload wins), newest month first.
// `scores` arrives ordered release_month desc, upload_date desc.
function dedupeByMonth(scores: ScoreRecord[]): ScoreRecord[] {
  const seen = new Set<string>()
  const out: ScoreRecord[] = []
  for (const s of scores) {
    const k = s.release_month || String(s.upload_date ?? s.id)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

// "2026-06" → "Jun 2026" for display.
function monthLabel(rm: string | null | undefined, fallbackDate?: string | null): string {
  const m = /^(\d{4})-(\d{2})$/.exec(rm ?? '')
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
    // Render in UTC — a local-timezone render of UTC midnight rolls back to the
    // previous month.
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  }
  return rm || (fallbackDate ? formatDate(fallbackDate) : '')
}

export function ScorePanel({ scores: rawScores }: { scores: ScoreRecord[] }) {
  const scores = dedupeByMonth(rawScores)
  const latest = scores[0]
  const prev = scores[1]
  const chron = [...scores].reverse() // oldest → newest for trend reading
  // Trend chart + history show by default (you use them); the toggle hides them.
  const [showTrend, setShowTrend] = useState(true)
  const gapDelta =
    latest?.gap_score != null && prev?.gap_score != null
      ? latest.gap_score - prev.gap_score
      : null

  return (
    <Card>
      <CardHeader
        title="Safety Scores"
        subtitle={
          latest
            ? `Bluewire upload ${formatDate(latest.upload_date)}${
                latest.release_month ? ` · ${latest.release_month}` : ''
              }`
            : 'No Bluewire scores on file'
        }
        action={
          <Link
            href="/upload"
            className="text-xs font-medium text-dts-blue hover:underline"
          >
            Upload scores →
          </Link>
        }
      />
      <CardBody>
        {!latest ? (
          <p className="text-sm text-gray-500">
            No score records yet. Upload a Bluewire export to populate GAP and
            category scores.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  GAP Score
                </div>
                <div
                  className={cn(
                    'text-5xl font-extrabold leading-none',
                    gapColor(latest.gap_score)
                  )}
                >
                  {formatScore(latest.gap_score)}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                  <span>Threshold: 65.00</span>
                  {gapDelta !== null && Math.abs(gapDelta) >= 0.01 && (
                    <span
                      className={cn(
                        'font-semibold',
                        gapDelta >= 0 ? 'text-green-600' : 'text-red-600'
                      )}
                    >
                      {gapDelta >= 0 ? '▲' : '▼'} {formatScore(Math.abs(gapDelta))} vs
                      last
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {latest.approval_level && (
                  <Badge tone={approvalTone(latest.approval_level)}>
                    {getApprovalLevelLabel(
                      latest.approval_level as ApprovalLevel
                    )}
                  </Badge>
                )}
                {latest.overall_pass ? (
                  <Badge tone="green">Overall pass</Badge>
                ) : (
                  <Badge tone="red">Requires revetting</Badge>
                )}
                {latest.rating_label && (
                  <span className="text-xs text-gray-500">
                    Rating: {latest.rating_label}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {SCORE_FIELDS.map((f) => {
                const val = latest[f.key as keyof ScoreRecord] as number | null
                const ignored = f.requirement === 'ignored'
                // null = not present or not considered; true/false = pass/fail.
                const pass = scoreFieldPasses(f.key, val)
                const prevVal = prev
                  ? (prev[f.key as keyof ScoreRecord] as number | null)
                  : null
                const d = val != null && prevVal != null ? val - prevVal : null
                const tone = ignored
                  ? 'border-gray-200 bg-gray-50'
                  : pass
                    ? 'border-green-200 bg-green-50'
                    : 'border-red-200 bg-red-50'
                return (
                  <div
                    key={f.key}
                    className={cn(
                      'flex items-center justify-between rounded-md border px-3 py-2',
                      tone
                    )}
                  >
                    <div>
                      <div className="text-xs font-medium text-gray-700">
                        {SHORT_LABEL[f.key] ?? f.label}
                        <span className="ml-1 text-[10px] font-normal text-gray-400">
                          {requirementNote(f.requirement)}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-lg font-bold text-gray-900">
                          {formatScore(val)}
                        </span>
                        {d !== null && Math.abs(d) >= 0.01 && (
                          <span
                            className={cn(
                              'text-[11px] font-semibold',
                              d >= 0 ? 'text-green-600' : 'text-red-600'
                            )}
                            title="Change vs. previous upload"
                          >
                            {d >= 0 ? '▲' : '▼'} {formatScore(Math.abs(d))}
                          </span>
                        )}
                      </div>
                    </div>
                    {!ignored && (
                      <span
                        className={cn(
                          'text-lg font-bold',
                          pass ? 'text-green-600' : 'text-red-600'
                        )}
                      >
                        {pass ? '✓' : '✕'}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Crash, Violation, CSA Basics, and Driver OOS must be ≥{' '}
              {MIN_30_THRESHOLD}. Critical/Acute Violation, New Entrant, MCS-150,
              and Safety Rating must be {PERFECT_SCORE}. Judicial Hellholes is not
              considered.
            </p>

            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowTrend((v) => !v)}
                className="text-xs font-medium text-dts-blue hover:underline"
              >
                {showTrend ? 'Hide score trend & history' : 'Show score trend & history'}
              </button>
            </div>

            {showTrend && (
            <div className="mt-4">
              <ScoreTrend scores={scores} />
            </div>
            )}

            {showTrend && scores.length > 1 && (
              <div className="mt-6">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Score history — trend by category
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <THead>
                      <TR className="hover:bg-transparent">
                        <TH>Category</TH>
                        {chron.map((s, i) => (
                          <TH
                            key={s.id}
                            className={cn(
                              'text-right whitespace-nowrap',
                              i === chron.length - 1 && 'text-gray-900'
                            )}
                          >
                            {monthLabel(s.release_month, s.upload_date)}
                          </TH>
                        ))}
                      </TR>
                    </THead>
                    <TBody>
                      {CATEGORY_ROWS.map((row) => (
                        <TR key={row.key}>
                          <TD className="whitespace-nowrap text-xs font-medium text-gray-700">
                            {row.label}
                          </TD>
                          {chron.map((s) => {
                            const v = s[row.key as keyof ScoreRecord] as number | null
                            let cls = 'text-gray-700'
                            if (row.kind === 'gap') {
                              cls = gapColor(v)
                            } else if (row.requirement === 'ignored') {
                              cls = 'text-gray-400'
                            } else {
                              const p = scoreFieldPasses(row.key, v)
                              cls =
                                p === false
                                  ? 'text-red-600'
                                  : p === true
                                    ? 'text-green-700'
                                    : 'text-gray-400'
                            }
                            return (
                              <TD
                                key={s.id}
                                className={cn('text-right font-semibold', cls)}
                              >
                                {formatScore(v)}
                              </TD>
                            )
                          })}
                        </TR>
                      ))}
                      <TR>
                        <TD className="whitespace-nowrap text-xs font-medium text-gray-700">
                          Result
                        </TD>
                        {chron.map((s) => (
                          <TD key={s.id} className="text-right">
                            {s.overall_pass ? (
                              <Badge tone="green">Pass</Badge>
                            ) : (
                              <Badge tone="red">Flag</Badge>
                            )}
                          </TD>
                        ))}
                      </TR>
                    </TBody>
                  </Table>
                </div>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  )
}
