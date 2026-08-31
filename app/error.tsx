'use client'

import { useEffect } from 'react'

/**
 * Route-level error boundary. Without this, any unhandled render error shows
 * Next's bare "Application error: a client-side exception has occurred", which
 * tells the user (and us) nothing.
 *
 * It also self-heals the most common cause in a frequently-deployed app: a tab
 * holding an older page asks for a hashed JS chunk that the new deploy replaced.
 * That's not a real bug — reload once and the new build loads cleanly.
 */
function isStaleChunkError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null
  const msg = `${e?.name ?? ''} ${e?.message ?? ''}`
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    msg
  )
}

const RELOAD_KEY = 'dts.chunkReloadAt'

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (!isStaleChunkError(error)) return
    // Guard against a reload loop if the chunk is genuinely gone: at most one
    // automatic reload per 30s.
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
      if (!Number.isFinite(last) || Date.now() - last > 30_000) {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
        window.location.reload()
      }
    } catch {
      /* storage unavailable — fall through to the UI below */
    }
  }, [error])

  const stale = isStaleChunkError(error)

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-base font-semibold text-gray-900">
          {stale ? 'Loading the latest version…' : 'Something went wrong'}
        </h1>
        <p className="mt-1.5 text-sm text-gray-600">
          {stale
            ? 'The app was updated while this page was open. Reloading to pick up the new version.'
            : 'This page hit an unexpected error. Try again — if it keeps happening, send us the reference below.'}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-md bg-dts-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-[#00547f]"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Reload page
          </button>
          <a
            href="/carriers"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Back to carriers
          </a>
        </div>
        {(error?.digest || error?.message) && (
          <p className="mt-4 break-words border-t border-gray-100 pt-3 font-mono text-[11px] text-gray-500">
            {error.digest ? `ref ${error.digest}` : null}
            {error.digest && error.message ? ' · ' : null}
            {error.message}
          </p>
        )}
      </div>
    </div>
  )
}
