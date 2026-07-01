'use client'

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

export function ScorePanel({ scores }: { scores: ScoreRecord[] }) {
  const latest = scores[0]
  const prev = scores[1]
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
                      <div className="text-lg font-bold text-gray-900">
                        {formatScore(val)}
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

            {scores.length > 1 && (
              <div className="mt-6">
                <ScoreTrend scores={scores} />
              </div>
            )}

            {scores.length > 1 && (
              <div className="mt-6">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Score history
                </div>
                <Table>
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Month</TH>
                      <TH className="text-right">GAP</TH>
                      <TH className="text-right">Crash</TH>
                      <TH className="text-right">Violation</TH>
                      <TH className="text-right">CSA</TH>
                      <TH className="text-right">Driver OOS</TH>
                      <TH>Result</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {scores.map((s) => (
                      <TR key={s.id}>
                        <TD className="whitespace-nowrap text-xs text-gray-600">
                          {s.release_month || formatDate(s.upload_date)}
                        </TD>
                        <TD
                          className={cn(
                            'text-right font-semibold',
                            gapColor(s.gap_score)
                          )}
                        >
                          {formatScore(s.gap_score)}
                        </TD>
                        <TD className="text-right">
                          {formatScore(s.crash_score)}
                        </TD>
                        <TD className="text-right">
                          {formatScore(s.violation_score)}
                        </TD>
                        <TD className="text-right">
                          {formatScore(s.csa_basics_score)}
                        </TD>
                        <TD className="text-right">
                          {formatScore(s.driver_oos_score)}
                        </TD>
                        <TD>
                          {s.overall_pass ? (
                            <Badge tone="green">Pass</Badge>
                          ) : (
                            <Badge tone="red">Flag</Badge>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  )
}
