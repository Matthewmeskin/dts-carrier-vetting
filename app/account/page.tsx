'use client'

import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { ROLE_LABEL, type Role } from '@/lib/roles'

// Account settings for the signed-in user. Today that's one thing: changing
// (or, for a Google-only sign-in, setting) the password. The current password
// is re-checked before a change so a walked-away-from screen can't be used to
// swap it.

type Me = { email: string | null; role: Role; fullName: string | null }

export default function AccountPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [hasPassword, setHasPassword] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const supabase = createSupabaseBrowserClient()
    Promise.all([
      fetch('/api/me', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      supabase.auth.getUser(),
    ])
      .then(([d, { data }]) => {
        if (cancelled) return
        if (d?.user) setMe(d.user)
        // A user who only ever signed in with Google has no email/password
        // identity yet; they set a password rather than change one.
        const ids = data.user?.identities ?? []
        setHasPassword(ids.some((i) => i.provider === 'email'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setDone(false)
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('The two new passwords don’t match.')
      return
    }
    if (hasPassword && password === current) {
      setError('The new password must be different from the current one.')
      return
    }
    setSaving(true)
    try {
      const supabase = createSupabaseBrowserClient()
      // The project requires the current password inside the same request
      // (Supabase "require current password" setting); the server checks it.
      const attrs = hasPassword ? { password, current_password: current } : { password }
      const { error } = await supabase.auth.updateUser(attrs as { password: string })
      if (error) {
        throw new Error(
          /current password/i.test(error.message) && hasPassword
            ? 'The current password is incorrect.'
            : error.message
        )
      }
      setDone(true)
      setHasPassword(true)
      setCurrent('')
      setPassword('')
      setConfirm('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the password')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size={20} />
      </div>
    )
  }

  if (!me) {
    return (
      <p className="text-sm text-gray-600">
        You’re not signed in.{' '}
        <a href="/login?next=/account" className="text-dts-blue hover:underline">
          Sign in
        </a>
      </p>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="font-heading text-lg font-semibold text-ink sm:text-xl">Account</h1>
        <p className="mt-1 text-sm text-gray-500">
          Signed in as <span className="font-medium text-gray-700">{me.email}</span>
          {' · '}
          {ROLE_LABEL[me.role] ?? me.role}
          {me.fullName ? ` · ${me.fullName}` : ''}
        </p>
      </div>

      <Card>
        <CardHeader
          title={hasPassword ? 'Change password' : 'Set a password'}
          subtitle={
            hasPassword
              ? 'Pick a new password for signing in with email.'
              : 'You sign in with Google today. Adding a password also lets you sign in with your email.'
          }
        />
        <CardBody>
          <form onSubmit={onSubmit} className="space-y-4">
            {/* Lets password managers know which account this is for. */}
            <input type="hidden" name="username" autoComplete="username" value={me.email ?? ''} readOnly />
            {hasPassword && (
              <Input
                label="Current password"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
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
            {done && (
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
                Password updated. Use it the next time you sign in.
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500">At least 8 characters.</p>
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner size={14} className="text-white" /> : null}
                {saving ? 'Saving…' : hasPassword ? 'Update password' : 'Set password'}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <p className="text-xs text-gray-500">
        Forgot your current password? Sign out and use “Forgot password?” on the login page.
      </p>
    </div>
  )
}
