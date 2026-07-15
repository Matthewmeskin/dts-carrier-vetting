'use client'

import { ScoreRecord } from '@/lib/types'
import { formatScore } from '@/lib/utils'

// A Bluewire-style multi-series trend chart: every category plotted over the
// release months we hold, on the same 0–100 severity bands Bluewire uses
// (red < 60, amber 60–75, green ≥ 75). It renders from the first month as a
// single column of points and fills into lines as history accumulates.

interface Series {
  key: keyof ScoreRecord
  label: string
  color: string
}

const SERIES: Series[] = [
  { key: 'gap_score', label: 'GAP', color: '#1d4ed8' },
  { key: 'crash_score', label: 'Crash', color: '#06b6d4' },
  { key: 'violation_score', label: 'Violation', color: '#eab308' },
  { key: 'csa_basics_score', label: 'CSA Basics', color: '#f97316' },
  { key: 'driver_oos_score', label: 'Driver OOS', color: '#ef4444' },
  { key: 'critical_acute_violation_score', label: 'Critical/Acute', color: '#111827' },
  { key: 'new_entrant_score', label: 'New Entrant', color: '#3b82f6' },
  { key: 'mcs_150_score', label: 'MCS-150', color: '#16a34a' },
  { key: 'judicial_hellholes_score', label: 'Hellhole', color: '#fb7185' },
  { key: 'safety_rating_score', label: 'Safety Rating', color: '#78350f' },
]

export function ScoreTrend({ scores }: { scores: ScoreRecord[] }) {
  // Oldest → newest so the trend reads left to right.
  const chron = [...scores].reverse()
  if (chron.length < 1) return null
  const single = chron.length === 1
  const n = chron.length

  // Layout — a wide viewBox scaled responsively.
  const W = 760
  const H = 320
  const padL = 34
  const padR = 12
  const padT = 10
  const padB = 26
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const x = (i: number) =>
    padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => padT + ((100 - v) / 100) * innerH

  // Label each snapshot by its upload date (snapshots can share a release
  // month), falling back to the release month or an index.
  const monthLabel = (s: ScoreRecord, i: number) => {
    if (s.upload_date) {
      const d = new Date(s.upload_date)
      if (!isNaN(d.getTime()))
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
    return s.release_month || `#${i + 1}`
  }

  // Severity bands (top→bottom): green ≥75, amber 60–75, red <60.
  const bands = [
    { from: 75, to: 100, fill: '#dcfce7' },
    { from: 60, to: 75, fill: '#fef9c3' },
    { from: 0, to: 60, fill: '#fee2e2' },
  ]

  // Only label points on a small history so it doesn't turn into noise.
  const showLabels = n <= 6

  return (
    <div className="rounded-md border border-gray-200 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Severity risk scores — {single ? 'latest upload' : `${n} uploads`}
        </span>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {SERIES.map((s) => (
            <span key={String(s.key)} className="inline-flex items-center gap-1 text-[11px] text-gray-600">
              <span className="inline-block h-2 w-3 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 'auto' }}
        role="img"
        aria-label="Category safety score trend"
      >
        {/* Severity bands */}
        {bands.map((b, i) => (
          <rect
            key={i}
            x={padL}
            y={y(b.to)}
            width={innerW}
            height={y(b.from) - y(b.to)}
            fill={b.fill}
            opacity={0.6}
          />
        ))}

        {/* Gridlines + Y labels */}
        {[0, 20, 40, 60, 80, 100].map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#e5e7eb" strokeWidth={1} />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#9ca3af">
              {v}
            </text>
          </g>
        ))}

        {/* X labels (months) */}
        {chron.map((s, i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            fontSize="9"
            fill="#9ca3af"
          >
            {monthLabel(s, i)}
          </text>
        ))}

        {/* Series lines + points */}
        {SERIES.map((series) => {
          const pts = chron
            .map((s, i) => {
              const v = s[series.key] as number | null | undefined
              return v == null ? null : { i, cx: x(i), cy: y(v), v }
            })
            .filter((p): p is { i: number; cx: number; cy: number; v: number } => p !== null)
          if (pts.length === 0) return null
          const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx},${p.cy}`).join(' ')
          return (
            <g key={String(series.key)}>
              {pts.length > 1 && (
                <path d={d} fill="none" stroke={series.color} strokeWidth={1.75} opacity={0.9} />
              )}
              {pts.map((p) => (
                <g key={p.i}>
                  <circle cx={p.cx} cy={p.cy} r={2.75} fill={series.color}>
                    <title>{`${series.label} · ${monthLabel(chron[p.i], p.i)}: ${formatScore(p.v)}`}</title>
                  </circle>
                  {showLabels && (
                    <text
                      x={p.cx}
                      y={p.cy - 5}
                      textAnchor="middle"
                      fontSize="8"
                      fontWeight="600"
                      fill={series.color}
                    >
                      {formatScore(p.v)}
                    </text>
                  )}
                </g>
              ))}
            </g>
          )
        })}
      </svg>
      {single && (
        <p className="mt-1 text-[11px] text-gray-400">
          One upload on file — the lines fill in with each new Bluewire upload.
        </p>
      )}
    </div>
  )
}
