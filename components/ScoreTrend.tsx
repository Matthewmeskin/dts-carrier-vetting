'use client'

import { ScoreRecord } from '@/lib/types'
import { formatScore } from '@/lib/utils'

const GAP_THRESHOLD = 65

function color(gap: number | null | undefined): string {
  if (gap === null || gap === undefined) return '#9ca3af'
  if (gap >= 65) return '#15803d'
  if (gap >= 60) return '#d97706'
  return '#dc2626'
}

/**
 * Dependency-free GAP-score trend chart across the stored Bluewire uploads.
 * `scores` arrives newest-first; we render oldest→newest left to right.
 */
export function ScoreTrend({ scores }: { scores: ScoreRecord[] }) {
  const chron = [...scores]
    .reverse()
    .filter((s) => s.gap_score !== null && s.gap_score !== undefined)
  if (chron.length < 2) return null

  const W = 320
  const H = 90
  const padX = 8
  const padY = 10
  const innerW = W - padX * 2
  const innerH = H - padY * 2
  const n = chron.length

  const x = (i: number) => padX + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => padY + ((100 - v) / 100) * innerH

  const points = chron.map((s, i) => ({
    cx: x(i),
    cy: y(s.gap_score as number),
    v: s.gap_score as number,
    label: s.release_month || '',
  }))
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx},${p.cy}`).join(' ')
  const thresholdY = y(GAP_THRESHOLD)

  const first = chron[0].gap_score as number
  const last = chron[n - 1].gap_score as number
  const delta = last - first

  return (
    <div className="rounded-md border border-gray-200 p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          GAP trend · {n} months
        </span>
        <span
          className="text-xs font-semibold"
          style={{ color: delta >= 0 ? '#15803d' : '#dc2626' }}
        >
          {delta >= 0 ? '▲' : '▼'} {formatScore(Math.abs(delta))} since{' '}
          {chron[0].release_month || 'start'}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-24 w-full"
        role="img"
        aria-label="GAP score trend"
      >
        {/* Threshold line at 65 */}
        <line
          x1={padX}
          x2={W - padX}
          y1={thresholdY}
          y2={thresholdY}
          stroke="#d1d5db"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
        <text x={W - padX} y={thresholdY - 3} textAnchor="end" fontSize="9" fill="#9ca3af">
          65
        </text>
        {/* Trend line */}
        <path d={linePath} fill="none" stroke="#0369a1" strokeWidth={2} />
        {/* Points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.cx} cy={p.cy} r={3.5} fill={color(p.v)} />
            {(i === 0 || i === n - 1) && (
              <text
                x={p.cx}
                y={p.cy - 7}
                textAnchor={i === 0 ? 'start' : 'end'}
                fontSize="10"
                fontWeight="700"
                fill={color(p.v)}
              >
                {formatScore(p.v)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-gray-400">
        <span>{chron[0].release_month || ''}</span>
        <span>{chron[n - 1].release_month || ''}</span>
      </div>
    </div>
  )
}
