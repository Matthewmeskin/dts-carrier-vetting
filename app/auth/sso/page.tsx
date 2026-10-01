'use client'

import { useEffect, useState } from 'react'
import { Spinner } from '@/components/ui/Spinner'
import { localPath } from '@/lib/dtsLogin'

// Landing point for single sign-on from the AP payables portal. The token
// arrives in the URL fragment — fragments never reach the server or its
// logs — and is exchanged same-origin for this portal's own session cookies.
export default function SsoPage() {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const accessToken = params.get('at') ?? ''
    // A page in this portal only, never another site.
    const next = localPath(params.get('next'))
    // The token has done its job the moment we read it; scrub it from the
    // address bar and history before the network call.
    window.history.replaceState(null, '', '/auth/sso')

    // A failed hand-off opens this portal's own login form (?local=1), not
    // /login, which now sends signed-out visitors back to the hub: that would
    // loop.
    const local = `/login?local=1&next=${encodeURIComponent(next)}`
    if (!accessToken) {
      window.location.replace(local)
      return
    }

    fetch('/api/auth/sso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('sso failed')
        window.location.replace(next)
      })
      .catch(() => {
        setFailed(true)
        window.location.replace(local)
      })
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-gray-500">
        <Spinner />
        {failed ? 'Redirecting to sign-in…' : 'Signing you in…'}
      </div>
    </div>
  )
}
