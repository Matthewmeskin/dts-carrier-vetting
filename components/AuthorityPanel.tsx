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
}: {
  insurance: InsuranceRecord | null
}) {
  const [showNotes, setShowNotes] = useState(false)

  if (!insurance) {
    return (
      <Card>
        <CardHeader title="Authority & Identity" />
        <CardBody>
          <p className="text-sm text-gray-500">
            No RMIS data on file yet. Use the Refresh button on the Insurance
            panel to pull authority and identity data.
          </p>
        </CardBody>
      </Card>
    )
  }

  const authAge =
    insurance.authority_days_active ??
    daysSince(insurance.authority_original_date)

  const notes = insurance.rmis_certification_notes ?? []

  return (
    <Card>
      <CardHeader title="Authority & Identity" subtitle="Sourced from RMIS / FMCSA" />
      <CardBody>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field
            label="Operating Status"
            value={insurance.operating_status}
          />
          <Field
            label="Contract Authority"
            value={
              insurance.contract_authority_status === 'A' ? (
                <Badge tone="green">Active (A)</Badge>
              ) : (
                <Badge tone="red">
                  {insurance.contract_authority_status || 'Unknown'}
                </Badge>
              )
            }
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
      </CardBody>
    </Card>
  )
}
