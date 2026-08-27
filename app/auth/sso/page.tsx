'use client'

import { useEffect, useState } from 'react'
import { Spinner } from '@/components/ui/Spinner'

// Landing point for single sign-on from the AP payables portal. The token
// arrives in the URL fragment — fragments never reach the server or its
// logs — and is exchanged same-origin for this portal's own session cookies.
export default function SsoPage() {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const accessToken = params.get('at') ?? ''
    const next = params.get('next') || '/carriers'
    // The token has done its job the moment we read it; scrub it from the
    // address bar and history before the network call.
    window.history.replaceState(null, '', '/auth/sso')

    if (!accessToken) {
      window.location.replace(`/login?next=${encodeURIComponent(next)}`)
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
        window.location.replace(`/login?next=${encodeURIComponent(next)}`)
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
