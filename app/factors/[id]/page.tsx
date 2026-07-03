'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge, carrierStatusTone, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { formatDate, formatDateTime } from '@/lib/utils'

function sosTone(norm: string | null | undefined): BadgeTone {
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

interface FactorDetail {
  id: string
  name: string
  approval_status: string
  approved_by: string | null
  approved_at: string | null
  sos_state: string | null
  sos_entity_id: string | null
  sos_status: string | null
  sos_status_normalized: string | null
  sos_entity_type: string | null
  sos_formation_date: string | null
  sos_registered_agent: string | null
  sos_registered_agent_address: string | null
  sos_principal_address: string | null
  sos_officers: string[] | null
  sos_match_confidence: string | null
  sos_summary: string | null
  sos_checked_at: string | null
  sos_source_url: string | null
}

interface LinkedCarrier {
  dot_number: string
  legal_name: string | null
  brokerware_status: string | null
  carrier_status: string | null
  city: string | null
  state: string | null
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-gray-900">{value ?? '—'}</dd>
    </div>
  )
}

export default function FactorDetailPage({ params }: { params: { id: string } }) {
  const id = params.id
  const [factor, setFactor] = useState<FactorDetail | null>(null)
  const [carriers, setCarriers] = useState<LinkedCarrier[]>([])
  const [variants, setVariants] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/factors/${id}`, { cache: 'no-store' })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Failed to load factor')
    } else {
      setFactor(data.factor)
      setCarriers(data.carriers ?? [])
      setVariants(data.mergedVariants ?? [])
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function setStatus(approval_status: string) {
    setBusy(true)
    try {
      await fetch('/api/factors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, approval_status }),
      })
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function recheck() {
    setError(null)
    let state: string | undefined
    if (!factor?.sos_state) {
      const entered =
        typeof window !== 'undefined'
          ? window.prompt(`2-letter state to search for "${factor?.name}"?`, '')
          : ''
      if (!entered) return
      state = entered
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/factors/${id}/sos`, {
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
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size={32} />
      </div>
    )
  }

  if (error && !factor) {
    return (
      <div className="space-y-4">
        <Link href="/factors" className="text-sm text-dts-blue hover:underline">
          ← Back to factors
        </Link>
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </div>
    )
  }

  if (!factor) return null

  return (
    <div className="space-y-5">
      <Link href="/factors" className="text-sm text-dts-blue hover:underline">
        ← Back to factors
      </Link>

      {/* Header + SOS */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-gray-900">{factor.name}</h1>
                <Badge tone={approvalTone(factor.approval_status)}>
                  {factor.approval_status === 'approved'
                    ? 'Approved'
                    : factor.approval_status === 'rejected'
                      ? 'Rejected'
                      : 'Needs review'}
                </Badge>
                {factor.sos_status && (
                  <Badge tone={sosTone(factor.sos_status_normalized)}>
                    SOS: {factor.sos_status}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Factoring company · {carriers.length} carrier
                {carriers.length === 1 ? '' : 's'} linked
                {factor.approved_by ? ` · approved by ${factor.approved_by}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {busy && <Spinner size={16} />}
              {factor.approval_status !== 'approved' && (
                <Button size="sm" variant="primary" onClick={() => setStatus('approved')} disabled={busy}>
                  Approve
                </Button>
              )}
              {factor.approval_status !== 'rejected' && (
                <Button size="sm" variant="outline" onClick={() => setStatus('rejected')} disabled={busy}>
                  Reject
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={recheck} disabled={busy}>
                Re-check SOS
              </Button>
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {error}
            </div>
          )}

          <div className="mt-5 border-t border-gray-100 pt-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-bold text-gray-900">Business Registration (SOS)</h3>
                <span className="text-xs text-gray-400">Secretary of State · via OpenSOS</span>
              </div>
              {factor.sos_source_url && (
                <a
                  href={factor.sos_source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-dts-blue hover:underline"
                >
                  View on Secretary of State ↗
                </a>
              )}
            </div>

            {factor.sos_checked_at ? (
              <>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Field
                    label="Entity Status"
                    value={
                      <Badge tone={sosTone(factor.sos_status_normalized)}>
                        {factor.sos_status || factor.sos_status_normalized || 'Unknown'}
                      </Badge>
                    }
                  />
                  <Field label="State" value={factor.sos_state} />
                  <Field label="Entity Type" value={factor.sos_entity_type} />
                  <Field label="Formation Date" value={formatDate(factor.sos_formation_date)} />
                  <Field label="State Entity ID" value={factor.sos_entity_id} />
                  <Field label="Match Confidence" value={factor.sos_match_confidence} />
                  <Field label="Registered Agent" value={factor.sos_registered_agent} />
                  <Field label="Principal Address" value={factor.sos_principal_address} />
                </dl>

                {factor.sos_officers && factor.sos_officers.length > 0 && (
                  <div className="mt-3">
                    <dt className="text-xs uppercase tracking-wide text-gray-500">Officers / Principals</dt>
                    <dd className="mt-1 flex flex-wrap gap-1">
                      {factor.sos_officers.map((o, i) => (
                        <Badge key={i} tone="gray">
                          {o}
                        </Badge>
                      ))}
                    </dd>
                  </div>
                )}

                {factor.sos_summary && (
                  <p className="mt-2 text-xs text-gray-500">{factor.sos_summary}</p>
                )}
                {factor.sos_checked_at && (
                  <p className="mt-1 text-xs text-gray-400">
                    Checked {formatDateTime(factor.sos_checked_at)}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500">
                No SOS record pulled yet. Click “Re-check SOS” to verify this factor’s registration.
              </p>
            )}

            {variants.length > 0 && (
              <p className="mt-3 text-xs text-gray-400">
                Also covers spelling variants: {variants.join(', ')}
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Linked carriers */}
      <Card>
        <CardHeader
          title={`Carriers paying this factor (${carriers.length})`}
          subtitle="Every carrier whose Brokerware pay-to resolves to this factor"
        />
        {carriers.length === 0 ? (
          <CardBody>
            <p className="text-sm text-gray-500">No carriers linked to this factor.</p>
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Carrier</th>
                  <th className="px-4 py-3">DOT</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Brokerware</th>
                  <th className="px-4 py-3">Vetting Status</th>
                </tr>
              </thead>
              <tbody>
                {carriers.map((c) => (
                  <tr key={c.dot_number} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/carriers/${c.dot_number}`}
                        className="font-medium text-dts-blue hover:underline"
                      >
                        {c.legal_name || `DOT ${c.dot_number}`}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{c.dot_number}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {[c.city, c.state].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={c.brokerware_status === 'Active' ? 'green' : 'gray'}>
                        {c.brokerware_status || '—'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={carrierStatusTone(c.carrier_status)}>
                        {c.carrier_status || '—'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
