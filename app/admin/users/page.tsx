'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { ROLE_LABEL, type Role } from '@/lib/roles'
import { formatDate } from '@/lib/utils'

interface UserRow {
  id: string
  email: string | null
  full_name: string | null
  role: Role
  created_at: string
}

const ROLES: Role[] = ['staff', 'manager', 'director']

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Add-user form
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('staff')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/users', { cache: 'no-store' })
    if (res.status === 403 || res.status === 401) {
      setForbidden(true)
      setLoading(false)
      return
    }
    const data = await res.json()
    setUsers(data.users ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function addUser(e: React.FormEvent) {
    e.preventDefault()
    setAdding(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, fullName, role }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create user')
      setEmail('')
      setFullName('')
      setPassword('')
      setRole('staff')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create user')
    } finally {
      setAdding(false)
    }
  }

  async function changeRole(id: string, newRole: Role) {
    setError(null)
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, role: newRole }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Could not update role')
    }
    await load()
  }

  async function removeUser(id: string, email: string | null) {
    if (!confirm(`Remove ${email ?? 'this user'}? They will lose access immediately.`)) return
    setError(null)
    const res = await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Could not remove user')
    }
    await load()
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Spinner size={16} /> Loading users…
      </div>
    )
  }
  if (forbidden) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-gray-600">
            This page is available to Directors only.
          </p>
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Users & access"
          subtitle="Add teammates and set what each can approve. Staff < Manager < Director."
        />
        <CardBody>
          <form onSubmit={addUser} className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Optional"
            />
            <Input
              label="Temp password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8+ characters"
              required
            />
            <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
            <div className="flex items-end">
              <Button type="submit" disabled={adding} className="w-full justify-center">
                {adding ? <Spinner size={14} className="text-white" /> : null}
                {adding ? 'Adding…' : 'Add user'}
              </Button>
            </div>
          </form>
          {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
          <p className="mt-2 text-xs text-gray-400">
            The user signs in with this email + temp password (or Google, if enabled). They can
            change their password later.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Team (${users.length})`} />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">User</th>
                  <th className="px-2 py-2">Role</th>
                  <th className="px-2 py-2">Added</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-gray-100">
                    <td className="px-2 py-2">
                      <div className="font-medium text-gray-900">{u.full_name || u.email}</div>
                      {u.full_name && (
                        <div className="text-xs text-gray-500">{u.email}</div>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <select
                        value={u.role}
                        onChange={(e) => changeRole(u.id, e.target.value as Role)}
                        className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-dts-blue focus:ring-dts-blue"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-gray-500">
                      {formatDate(u.created_at)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        onClick={() => removeUser(u.id, u.email)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
