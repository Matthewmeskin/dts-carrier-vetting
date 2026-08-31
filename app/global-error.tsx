'use client'

import { useEffect } from 'react'

/**
 * Last-resort boundary for errors thrown in the root layout itself (where
 * app/error.tsx can't render, because the layout is what failed). Must supply
 * its own <html>/<body>, and can't rely on the app's providers.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    const msg = `${error?.name ?? ''} ${error?.message ?? ''}`
    if (
      !/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
        msg
      )
    ) {
      return
    }
    try {
      const KEY = 'dts.chunkReloadAt'
      const last = Number(sessionStorage.getItem(KEY) ?? 0)
      if (!Number.isFinite(last) || Date.now() - last > 30_000) {
        sessionStorage.setItem(KEY, String(Date.now()))
        window.location.reload()
      }
    } catch {
      /* ignore */
    }
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          margin: 0,
          background: '#f3f4f6',
        }}
      >
        <div style={{ maxWidth: 520, margin: '0 auto', padding: '64px 16px' }}>
          <div
            style={{
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: 24,
            }}
          >
            <h1 style={{ margin: 0, fontSize: 16, color: '#111827' }}>
              Something went wrong
            </h1>
            <p style={{ marginTop: 6, fontSize: 14, color: '#4b5563' }}>
              The portal hit an unexpected error while loading. Reloading usually
              clears it.
            </p>
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => reset()}
                style={{
                  background: '#0063A0',
                  color: '#fff',
                  border: 0,
                  borderRadius: 6,
                  padding: '6px 12px',
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  background: '#fff',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  padding: '6px 12px',
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                Reload
              </button>
            </div>
            {(error?.digest || error?.message) && (
              <p
                style={{
                  marginTop: 16,
                  paddingTop: 12,
                  borderTop: '1px solid #f3f4f6',
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 11,
                  color: '#6b7280',
                  wordBreak: 'break-word',
                }}
              >
                {error.digest ? `ref ${error.digest}` : null}
                {error.digest && error.message ? ' · ' : null}
                {error.message}
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  )
}
