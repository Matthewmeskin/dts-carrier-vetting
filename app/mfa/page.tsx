'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'

function MfaForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') || '/carriers'

  const [code, setCode] = useState('')
  const [remember, setRemember] = useState(true)
  const [sending, setSending] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sentOnce = useRef(false)

  async function sendCode() {
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/mfa/send', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not send a code.')
      setSentTo('your email')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send a code.')
    } finally {
      setSending(false)
    }
  }

  // Auto-send one code when the page opens (guard against double-invoke).
  useEffect(() => {
    if (sentOnce.current) return
    sentOnce.current = true
    void sendCode()
  }, [])

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setVerifying(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, remember }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Verification failed.')
      // Full navigation so the middleware sees the new MFA cookie.
      window.location.assign(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed.')
      setVerifying(false)
    }
  }

  async function signOut() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    document.cookie = 'dts_active=; path=/; max-age=0'
    document.cookie = 'dts_session_start=; path=/; max-age=0'
    document.cookie = 'dts_mfa=; path=/; max-age=0'
    window.location.assign('/login')
  }

  return (
    <div className="mx-auto mt-16 w-full max-w-sm">
      <div className="mb-6 flex justify-center">
        <Logo className="h-10 w-auto" />
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">Verify it’s you</h1>
        <p className="mt-1 text-sm text-gray-600">
          {sending
            ? 'Sending a 6-digit code to your email…'
            : sentTo
              ? 'We emailed you a 6-digit code. Enter it below to continue.'
              : 'Enter the 6-digit code from your email.'}
        </p>

        <form onSubmit={verify} className="mt-4 space-y-3">
          <Input
            label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            autoFocus
          />
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Remember this device (skip the code here for 30 days)
          </label>
          <Button
            type="submit"
            disabled={verifying || code.length !== 6}
            className="w-full justify-center"
          >
            {verifying ? <Spinner size={14} className="text-white" /> : null}
            {verifying ? 'Verifying…' : 'Verify & continue'}
          </Button>
        </form>

        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={sendCode}
            disabled={sending}
            className="text-dts-blue hover:underline disabled:opacity-50"
          >
            Resend code
          </button>
          <button
            type="button"
            onClick={signOut}
            className="text-gray-500 hover:underline"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MfaPage() {
  return (
    <Suspense fallback={null}>
      <MfaForm />
    </Suspense>
  )
}
