'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { FactorRecord } from '@/lib/types'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { formatDate, formatDateTime } from '@/lib/utils'

function statusTone(norm: string | null | undefined): BadgeTone {
  switch ((norm || '').toLowerCase()) {
    case 'active':
      return 'green'
    case 'delinquent':
      return 'amber'
    case 'dissolved':
    case 'inactive':
      return 'red'
    default:
      return 'gray'
  }
}

function approvalTone(status: string): BadgeTone {
  return status === 'approved' ? 'green' : status === 'rejected' ? 'red' : 'amber'
}

export default function FactorsPage() {
  const [factors, setFactors] = useState<FactorRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [recheckId, setRecheckId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/factors', { cache: 'no-store' })
    const data = await res.json()
    setFactors(data.factors ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function setStatus(id: string, approval_status: string) {
    setSavingId(id)
    try {
      await fetch('/api/factors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, approval_status }),
      })
      await load()
    } finally {
      setSavingId(null)
    }
  }

  async function recheck(f: FactorRecord) {
    setError(null)
    // If we've never resolved a state for this factor, ask for one.
    let state: string | undefined
    if (!f.sos_state) {
      const entered =
        typeof window !== 'undefined'
          ? window.prompt(`2-letter state to search for "${f.name}"?`, '')
          : ''
      if (!entered) return
      state = entered
    }
    setRecheckId(f.id)
    try {
      const res = await fetch(`/api/factors/${f.id}/sos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state ? { state } : {}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Re-check failed')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Re-check failed')
    } finally {
      setRecheckId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size={32} />
      </div>
    )
  }

  const pending = factors.filter((f) => f.approval_status === 'review').length

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Approved Factors</h1>
        <p className="mt-1 text-sm text-gray-500">
          Factoring companies that receive carrier payments. Each is verified against Secretary-of-State
          records once and reused across every carrier that shares it.
          {pending > 0 && (
            <span className="ml-1 font-medium text-amber-700">{pending} awaiting review.</span>
          )}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          {error}
        </div>
      )}

      {factors.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-gray-500">
              No factors yet. They’re created automatically the first time a factoring carrier’s SOS check
              runs.
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Factor</th>
                  <th className="px-4 py-3">Approval</th>
                  <th className="px-4 py-3">SOS Status</th>
                  <th className="px-4 py-3">State</th>
                  <th className="px-4 py-3">Formed</th>
                  <th className="px-4 py-3">Carriers</th>
                  <th className="px-4 py-3">Checked</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {factors.map((f) => (
                  <tr key={f.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/factors/${f.id}`}
                        className="font-medium text-dts-blue hover:underline"
                      >
                        {f.name}
                      </Link>
                      {f.sos_summary && (
                        <div className="mt-0.5 max-w-md text-xs text-gray-500">{f.sos_summary}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={approvalTone(f.approval_status)}>
                        {f.approval_status === 'approved'
                          ? 'Approved'
                          : f.approval_status === 'rejected'
                            ? 'Rejected'
                            : 'Needs review'}
                      </Badge>
                      {f.approved_by && (
                        <div className="mt-0.5 text-xs text-gray-400">by {f.approved_by}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {f.sos_status ? (
                        <Badge tone={statusTone(f.sos_status_normalized)}>{f.sos_status}</Badge>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{f.sos_state || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{formatDate(f.sos_formation_date)}</td>
                    <td className="px-4 py-3 text-gray-700">{f.carrier_count ?? 0}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {f.sos_checked_at ? formatDateTime(f.sos_checked_at) : 'Not checked'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {savingId === f.id || recheckId === f.id ? (
                          <Spinner size={16} />
                        ) : (
                          <>
                            {f.approval_status !== 'approved' && (
                              <Button size="sm" variant="primary" onClick={() => setStatus(f.id, 'approved')}>
                                Approve
                              </Button>
                            )}
                            {f.approval_status !== 'rejected' && (
                              <Button size="sm" variant="outline" onClick={() => setStatus(f.id, 'rejected')}>
                                Reject
                              </Button>
                            )}
                            {f.approval_status !== 'review' && (
                              <Button size="sm" variant="ghost" onClick={() => setStatus(f.id, 'review')}>
                                Reset
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => recheck(f)}>
                              Re-check SOS
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
