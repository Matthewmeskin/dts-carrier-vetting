'use client'

import { useState } from 'react'
import { ScoreRecord } from '@/lib/types'
import { formatScore } from '@/lib/utils'

// A Bluewire-style multi-series trend chart: every category plotted over the
// uploads we hold, on the same 0–100 severity bands Bluewire uses (red < 60,
// amber 60–75, green ≥ 75). Interactive: click a legend item to show/hide that
// series, hover a column for a tooltip of every value at that upload.

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

// "2026-06" → "Jun 2026" for the axis; falls back to the upload date.
function monthKey(s: ScoreRecord): string {
  return s.release_month || String(s.upload_date ?? s.id)
}
function monthLabelOf(s: ScoreRecord): string {
  const m = /^(\d{4})-(\d{2})$/.exec(s.release_month ?? '')
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }
  if (s.upload_date) {
    const d = new Date(s.upload_date)
    if (!isNaN(d.getTime()))
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  return s.release_month || ''
}

export function ScoreTrend({ scores }: { scores: ScoreRecord[] }) {
  // One point per FMCSA release month, oldest → newest so the trend reads left
  // to right. (Dedupe defensively in case multiple uploads share a month.)
  const seen = new Set<string>()
  const chron = [...scores]
    .filter((s) => {
      const k = monthKey(s)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((a, b) => (monthKey(a) < monthKey(b) ? -1 : monthKey(a) > monthKey(b) ? 1 : 0))
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<number | null>(null)

  if (chron.length < 1) return null
  const single = chron.length === 1
  const n = chron.length

  const toggle = (k: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      next.has(k) ? next.delete(k) : next.add(k)
      return next
    })
  const isHidden = (k: string) => hidden.has(k)

  // Layout — a wide viewBox scaled responsively.
  const W = 760
  const H = 320
  const padL = 34
  const padR = 12
  const padT = 10
  const padB = 26
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const x = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => padT + ((100 - v) / 100) * innerH

  const label = (s: ScoreRecord, _i: number) => monthLabelOf(s)

  const bands = [
    { from: 75, to: 100, fill: '#dcfce7' },
    { from: 60, to: 75, fill: '#fef9c3' },
    { from: 0, to: 60, fill: '#fee2e2' },
  ]

  // Mouse-over hit band for each column (snaps the tooltip to the nearest point).
  const bandBounds = (i: number) => {
    const left = i === 0 ? padL : (x(i - 1) + x(i)) / 2
    const right = i === n - 1 ? W - padR : (x(i) + x(i + 1)) / 2
    return { left, width: Math.max(1, right - left) }
  }

  // Tooltip horizontal placement: keep it on-screen at the edges.
  const hoverFrac = hover != null ? x(hover) / W : 0
  const tipAlign =
    hover === 0 ? 'left' : hover === n - 1 ? 'right' : 'center'
  const tipStyle: React.CSSProperties =
    tipAlign === 'left'
      ? { left: `${hoverFrac * 100}%`, transform: 'translateX(0)' }
      : tipAlign === 'right'
        ? { left: `${hoverFrac * 100}%`, transform: 'translateX(-100%)' }
        : { left: `${hoverFrac * 100}%`, transform: 'translateX(-50%)' }

  return (
    <div className="rounded-md border border-gray-200 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Severity risk scores — {single ? 'latest upload' : `${n} uploads`}
        </span>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {SERIES.map((s) => {
            const off = isHidden(String(s.key))
            return (
              <button
                key={String(s.key)}
                type="button"
                onClick={() => toggle(String(s.key))}
                className="inline-flex items-center gap-1 text-[11px] text-gray-600 hover:text-gray-900"
                title={off ? 'Show' : 'Hide'}
              >
                <span
                  className="inline-block h-2 w-3 rounded-sm"
                  style={{ background: s.color, opacity: off ? 0.25 : 1 }}
                />
                <span className={off ? 'text-gray-400 line-through' : ''}>{s.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: 'auto' }}
          role="img"
          aria-label="Category safety score trend"
          onMouseLeave={() => setHover(null)}
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

          {/* Hover guide line */}
          {hover != null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={padT}
              y2={H - padB}
              stroke="#9ca3af"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {/* X labels */}
          {chron.map((s, i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize="9"
              fontWeight={hover === i ? 700 : 400}
              fill={hover === i ? '#374151' : '#9ca3af'}
            >
              {label(s, i)}
            </text>
          ))}

          {/* Series lines + points */}
          {SERIES.map((series) => {
            if (isHidden(String(series.key))) return null
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
                  <circle
                    key={p.i}
                    cx={p.cx}
                    cy={p.cy}
                    r={hover === p.i ? 4 : 2.75}
                    fill={series.color}
                    stroke={hover === p.i ? '#fff' : 'none'}
                    strokeWidth={hover === p.i ? 1 : 0}
                  />
                ))}
                {/* Value label on the most recent point for at-a-glance reading */}
                {(() => {
                  const last = pts[pts.length - 1]
                  return (
                    <text
                      x={last.cx + 5}
                      y={last.cy + 3}
                      textAnchor="start"
                      fontSize="8"
                      fontWeight="600"
                      fill={series.color}
                    >
                      {formatScore(last.v)}
                    </text>
                  )
                })()}
              </g>
            )
          })}

          {/* Invisible hit bands to drive the hover tooltip */}
          {chron.map((_, i) => {
            const b = bandBounds(i)
            return (
              <rect
                key={i}
                x={b.left}
                y={padT}
                width={b.width}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                style={{ cursor: 'pointer' }}
              />
            )
          })}
        </svg>

        {/* Hover tooltip */}
        {hover != null && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-md border border-gray-200 bg-white/95 px-2 py-1.5 shadow-lg"
            style={tipStyle}
          >
            <div className="mb-1 text-[11px] font-semibold text-gray-700">
              {label(chron[hover], hover)}
            </div>
            <div className="space-y-0.5">
              {SERIES.filter((s) => !isHidden(String(s.key))).map((s) => {
                const v = chron[hover]?.[s.key] as number | null | undefined
                return (
                  <div key={String(s.key)} className="flex items-center gap-1.5 whitespace-nowrap text-[11px]">
                    <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
                    <span className="text-gray-500">{s.label}</span>
                    <span className="ml-auto font-semibold text-gray-800">
                      {v == null ? '—' : formatScore(v)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
      {single && (
        <p className="mt-1 text-[11px] text-gray-400">
          One upload on file — the lines fill in with each new Bluewire upload.
        </p>
      )}
    </div>
  )
}
