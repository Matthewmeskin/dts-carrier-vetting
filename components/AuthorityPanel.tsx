'use client'

import { useState } from 'react'
import { InsuranceRecord } from '@/lib/types'
import { Card, CardHeader, CardBody } from './ui/Card'
import { Badge } from './ui/Badge'
import { formatDate, daysSince } from '@/lib/utils'

function Field({
  label,
  value,
  className,
}: {
  label: string
  value: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-gray-900">
        {value ?? '—'}
      </dd>
    </div>
  )
}

export function AuthorityPanel({
  insurance,
  carrier,
  bare,
}: {
  insurance: InsuranceRecord | null
  carrier?: { legal_name: string | null; dba_name: string | null } | null
  bare?: boolean
}) {
  const [showNotes, setShowNotes] = useState(false)

  // In `bare` mode, render inside the parent tile (no own Card) with a divider
  // and small heading; otherwise render as a standalone card.
  const wrap = (children: React.ReactNode) =>
    bare ? (
      <div className="mt-5 border-t border-gray-100 pt-4">
        <div className="mb-3 flex items-baseline gap-2">
          <h3 className="text-sm font-bold text-gray-900">Authority &amp; Identity</h3>
          <span className="text-xs text-gray-400">Sourced from RMIS / FMCSA</span>
        </div>
        {children}
      </div>
    ) : (
      <Card>
        <CardHeader title="Authority & Identity" subtitle="Sourced from RMIS / FMCSA" />
        <CardBody>{children}</CardBody>
      </Card>
    )

  if (!insurance) {
    return wrap(
      <p className="text-sm text-gray-500">
        No RMIS data on file yet. Use the Refresh button on the Insurance panel to
        pull authority and identity data.
      </p>
    )
  }

  const authAge =
    insurance.authority_days_active ??
    daysSince(insurance.authority_original_date)

  const notes = insurance.rmis_certification_notes ?? []

  const tmsName = carrier?.legal_name
  const rmisLegal = insurance.rmis_legal_name
  const rmisDba = insurance.rmis_dba_name
  const showNames = tmsName || rmisLegal || rmisDba

  return wrap(
    <>
      {showNames && (
        <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Business Names
          </p>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="TMS Name (our system)" value={tmsName} />
            <Field label="Legal Name (RMIS / FMCSA)" value={rmisLegal} />
            {rmisDba && <Field label="DBA Name (RMIS / FMCSA)" value={rmisDba} />}
          </dl>
          {rmisLegal && rmisDba && rmisLegal !== rmisDba && (
            <p className="mt-2 text-xs text-amber-700">
              Operates under a DBA — the FMCSA legal entity ({rmisLegal}) differs
              from the operating name ({rmisDba}).
            </p>
          )}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field
            label="Operating Status"
            value={insurance.operating_status}
          />
          <Field
            label="Operating Authority"
            value={(() => {
              const active: string[] = []
              if (insurance.common_authority_status === 'A') active.push('Common')
              if (insurance.contract_authority_status === 'A') active.push('Contract')
              if (insurance.broker_authority_status === 'A') active.push('Broker')
              return active.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {active.map((a) => (
                    <Badge key={a} tone="green">
                      {a}
                    </Badge>
                  ))}
                </div>
              ) : (
                <Badge tone="red">None active</Badge>
              )
            })()}
          />
          <Field
            label="RMIS Certified"
            value={
              insurance.rmis_is_certified ? (
                <Badge tone="green">Certified</Badge>
              ) : (
                <Badge tone="gray">Not certified</Badge>
              )
            }
          />
          <Field
            label="Authority Granted"
            value={formatDate(insurance.authority_original_date)}
          />
          <Field
            label="Authority Age"
            value={authAge !== null ? `${authAge} days` : '—'}
          />
          <Field
            label="Reinstated"
            value={
              insurance.authority_reinstatement_date
                ? formatDate(insurance.authority_reinstatement_date)
                : '—'
            }
          />
          {insurance.authority_revocation_date && (
            <Field
              label="Prior Revocation"
              value={
                <span className="text-amber-600">
                  {formatDate(insurance.authority_revocation_date)}
                </span>
              }
            />
          )}
          <Field
            label="Factoring"
            value={
              insurance.is_factoring ? (
                <Badge tone="amber">Yes</Badge>
              ) : (
                <Badge tone="gray">No</Badge>
              )
            }
          />
          {insurance.is_factoring && (
            <Field
              label="Pay-To Entity"
              value={insurance.pay_to_entity}
              className="col-span-2"
            />
          )}
          <Field
            label="W-9 on File"
            value={
              insurance.w9_on_file ? (
                <Badge tone="green">Yes</Badge>
              ) : (
                <Badge tone="red">No</Badge>
              )
            }
          />
          {insurance.w9_business_name && (
            <Field label="W-9 Business Name" value={insurance.w9_business_name} />
          )}
          {insurance.w9_company_type && (
            <Field
              label="Business Type (W-9)"
              value={<Badge tone="blue">{insurance.w9_company_type}</Badge>}
            />
          )}
          <Field
            label="Broker-Carrier Agreement"
            value={
              insurance.broker_carrier_agreement_on_file ? (
                <Badge tone="green">On file</Badge>
              ) : (
                <Badge tone="red">Missing</Badge>
              )
            }
          />
          {insurance.broker_carrier_agreement_date && (
            <Field
              label="Agreement Date"
              value={formatDate(insurance.broker_carrier_agreement_date)}
            />
          )}
        </dl>

        {notes.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <button
              onClick={() => setShowNotes((v) => !v)}
              className="text-xs font-medium text-dts-blue hover:underline"
            >
              {showNotes ? 'Hide' : 'Show'} RMIS certification notes ({notes.length})
            </button>
            {showNotes && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
                {notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        )}
    </>
  )
}
