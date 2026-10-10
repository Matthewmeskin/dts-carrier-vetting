'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge, carrierStatusTone } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { PageHeader } from '@/components/ui/PageHeader'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { cn, formatDate } from '@/lib/utils'

// Policy check: the carriers DTS actually used, checked against the policy for
// the mode they hauled. Truckload loads get Sections 1 to 8; LTL and air get
// Section 9. Read from each carrier's current record.

interface Row {
  key: string
  dot: string | null
  name: string
  status: string | null
  loads: number
  lastPickup: string | null
  modes: string[]
  section: 'Truckload' | 'Section 9'
  issues: string[]
}
interface Result {
  days: number
  loadsChecked: number
  carriersUsed: number
  rows: Row[]
  declinedButActive: { dot: string; name: string; status: string; brokerware: string | null }[]
}

const WINDOWS = [7, 30, 90]

export default function PolicyCheckPage() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [section, setSection] = useState<'all' | 'Truckload' | 'Section 9'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/policy-check?days=${days}`, { cache: 'no-store' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not run the policy check')
      setData(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not run the policy check')
    } finally {
      setLoading(false)
    }
  }, [days])
  useEffect(() => {
    load()
  }, [load])

  const rows = (data?.rows ?? []).filter((r) => section === 'all' || r.section === section)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Policy check"
        subtitle="Carriers used on loads that don’t meet the vetting policy for the mode they hauled. Truckload uses Sections 1 to 8; LTL and air use Section 9. Checked against each carrier’s current record."
        action={
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setDays(w)}
                className={cn('rounded-md px-3 py-1', days === w ? 'bg-white font-semibold shadow-sm' : 'text-gray-500')}
              >
                {w} days
              </button>
            ))}
          </div>
        }
      />

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Loads checked" value={data.loadsChecked} />
            <Stat label="Carriers used" value={data.carriersUsed} />
            <Stat label="Carriers with an issue" value={data.rows.length} tone={data.rows.length ? 'red' : 'green'} />
          </div>

          <Card>
            <CardBody>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                {(['all', 'Truckload', 'Section 9'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSection(s)}
                    className={cn('rounded-full border px-3 py-0.5', section === s ? 'border-dts-blue bg-blue-50 font-semibold text-dts-blue' : 'border-gray-200 text-gray-600')}
                  >
                    {s === 'all' ? 'All' : s}
                  </button>
                ))}
              </div>
              {rows.length === 0 ? (
                <p className="text-sm text-green-700">Every carrier used in this window meets the policy.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <THead>
                      <TR className="hover:bg-transparent">
                        <TH>Carrier</TH>
                        <TH>Status</TH>
                        <TH>Policy</TH>
                        <TH className="text-right">Loads</TH>
                        <TH>Last pickup</TH>
                        <TH>What doesn’t meet the policy</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {rows.map((r) => (
                        <TR key={r.key}>
                          <TD className="font-medium">
                            {r.dot ? (
                              <Link href={`/carriers/${r.dot}`} className="text-dts-blue hover:underline">{r.name}</Link>
                            ) : (
                              r.name
                            )}
                            <div className="text-[11px] text-gray-400">{r.modes.join(', ')}</div>
                          </TD>
                          <TD>{r.status ? <Badge tone={carrierStatusTone(r.status)}>{r.status}</Badge> : <Badge tone="red">Not in portal</Badge>}</TD>
                          <TD className="whitespace-nowrap text-xs">{r.section}</TD>
                          <TD className="text-right">{r.loads}</TD>
                          <TD className="whitespace-nowrap text-xs">{r.lastPickup ? formatDate(r.lastPickup) : '—'}</TD>
                          <TD>
                            <ul className="list-disc space-y-0.5 pl-4 text-xs text-gray-700">
                              {r.issues.map((i) => <li key={i}>{i}</li>)}
                            </ul>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h2 className="text-sm font-semibold text-ink">Declined here, still active in Brokerware</h2>
              <p className="mb-2 text-xs text-gray-500">The policy says a declined carrier is disabled in the TMS. Disable these in Brokerware.</p>
              {data.declinedButActive.length === 0 ? (
                <p className="text-sm text-green-700">None.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {data.declinedButActive.map((c) => (
                    <li key={c.dot}>
                      <Link href={`/carriers/${c.dot}`} className="text-dts-blue hover:underline">{c.name}</Link>{' '}
                      <span className="text-xs text-gray-500">({c.status}; Brokerware: {c.brokerware ?? 'unknown'})</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      ) : null}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'red' | 'green' }) {
  return (
    <Card>
      <CardBody>
        <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
        <div className={cn('text-2xl font-bold', tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-green-700' : 'text-ink')}>{value}</div>
      </CardBody>
    </Card>
  )
}
