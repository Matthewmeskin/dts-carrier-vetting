'use client'

import { useState } from 'react'

// Prefers the official PNG at /public/dts-logo.png. If that file isn't present
// yet, it falls back to the SVG so the header never shows a broken image.
export function Logo({ className }: { className?: string }) {
  const [src, setSrc] = useState('/dts-logo.png')
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="DTS — Diversified Transportation Services"
      className={className}
      onError={() => {
        if (src !== '/dts-logo.svg') setSrc('/dts-logo.svg')
      }}
    />
  )
}
