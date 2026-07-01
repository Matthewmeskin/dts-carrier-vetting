'use client'

import { useState } from 'react'

// Tries the official logo (png, then uppercase .PNG) and falls back to the SVG
// so the header never shows a broken image.
const CANDIDATES = ['/dts-logo.png', '/dts-logo.PNG', '/dts-logo.svg']

export function Logo({ className }: { className?: string }) {
  const [i, setI] = useState(0)
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={CANDIDATES[i]}
      alt="DTS — Diversified Transportation Services"
      className={className}
      onError={() => setI((x) => Math.min(x + 1, CANDIDATES.length - 1))}
    />
  )
}
