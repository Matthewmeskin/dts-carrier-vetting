'use client'

import { useEffect, useState } from 'react'
import { createRecoveryClient } from '@/lib/supabaseRecovery'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'

// Where a password-reset link lands. The link carries a short-lived recovery
// session in the URL fragment; the recovery client picks it up, the person
// chooses a new password, and then signs in normally. One DTS login covers
// every portal, so the new password applies to all of them.
export default function ResetPasswordPage() {
  const [ready, setReady] = useState<'checking' | 'ok' | 'none'>('checking')
  const [email, setEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const supabase = createRecoveryClient()
    // getSession() waits for the client to parse the fragment first.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        setEmail(data.session.user.email ?? null)
        setReady('ok')
      } else {
        setReady('none')
      }
    })
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('The two passwords don’t match.')
      return
    }
    setSaving(true)
    try {
      const supabase = createRecoveryClient()
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      // Drop the recovery session; the person signs in fresh with the new password.
      await supabase.auth.signOut({ scope: 'local' })
      window.location.assign('/login?reset=done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the password')
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Logo className="h-10 w-auto" />
          <span className="text-sm font-medium text-gray-500">Set a new password</span>
        </div>
        {ready === 'checking' ? (
          <div className="flex justify-center py-6">
            <Spinner size={18} />
          </div>
        ) : ready === 'none' ? (
          <div className="space-y-3 text-sm text-gray-600">
            <p>This reset link has expired or was already used.</p>
            <a href="/login?reset=1" className="block text-center text-dts-blue hover:underline">
              Request a new reset link
            </a>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            {email && (
              <p className="text-sm text-gray-600">
                Choosing a new password for <span className="font-medium">{email}</span>. It
                applies to every DTS portal.
              </p>
            )}
            <input type="hidden" name="username" autoComplete="username" value={email ?? ''} readOnly />
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
            <Input
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
            />
            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}
            <Button type="submit" disabled={saving} className="w-full justify-center">
              {saving ? <Spinner size={14} className="text-white" /> : null}
              {saving ? 'Saving…' : 'Save new password'}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
