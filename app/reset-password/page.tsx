'use client'

import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'

// Where a password-reset link lands after /auth/callback has exchanged the
// code for a session: the user is signed in on a recovery session and picks a
// new password. On success they go straight to the portal.
export default function ResetPasswordPage() {
  const [ready, setReady] = useState<'checking' | 'ok' | 'none'>('checking')
  const [email, setEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setEmail(data.user.email ?? null)
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
      const supabase = createSupabaseBrowserClient()
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      // Full navigation so the middleware picks up the refreshed session.
      window.location.assign('/carriers')
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
                Choosing a new password for <span className="font-medium">{email}</span>.
              </p>
            )}
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
