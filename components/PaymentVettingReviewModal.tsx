'use client'

import { useEffect, useState } from 'react'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Spinner } from './ui/Spinner'

interface ReviewDoc {
  id: string
  file_name: string | null
  url: string | null
}

interface ReviewState {
  load_number: string
  date_of_factor: string
  factor_phone: string
  contact_name: string
  contact_dept: string
  remit_confirmed: string
  confirmed_by: string
  call_datetime: string
  decision: string
  notes: string
}

const EMPTY: ReviewState = {
  load_number: '',
  date_of_factor: '',
  factor_phone: '',
  contact_name: '',
  contact_dept: '',
  remit_confirmed: '',
  confirmed_by: '',
  call_datetime: '',
  decision: '',
  notes: '',
}

// In-portal review of a payment-vetting report: the report is shown inline
// (embedded) next to the payment-confirmation call form, so a reviewer logs the
// call + decision + notes in the system instead of printing the PDF.
export function PaymentVettingReviewModal({
  dot,
  doc,
  onClose,
  onSaved,
}: {
  dot: string
  doc: ReviewDoc
  onClose: () => void
  onSaved?: () => void
}) {
  const [form, setForm] = useState<ReviewState>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const set = (k: keyof ReviewState, v: string) =>
    setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [rev, me] = await Promise.all([
          fetch(
            `/api/carriers/${dot}/payment-vetting/review?documentId=${encodeURIComponent(doc.id)}`,
            { cache: 'no-store' }
          ).then((r) => (r.ok ? r.json() : null)),
          fetch('/api/me', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
        ])
        if (!alive) return
        const r = rev?.review
        if (r) {
          setForm({
            load_number: r.load_number ?? '',
            date_of_factor: r.date_of_factor ?? '',
            factor_phone: r.factor_phone ?? '',
            contact_name: r.contact_name ?? '',
            contact_dept: r.contact_dept ?? '',
            remit_confirmed: r.remit_confirmed ?? '',
            confirmed_by: r.confirmed_by ?? me?.user?.fullName ?? '',
            call_datetime: r.call_datetime ?? '',
            decision: r.decision ?? '',
            notes: r.notes ?? '',
          })
          setSavedAt(r.reviewed_at ?? null)
        } else {
          setForm((f) => ({ ...f, confirmed_by: me?.user?.fullName ?? '' }))
        }
      } catch {
        /* best-effort prefill */
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [dot, doc.id])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/carriers/${dot}/payment-vetting/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: doc.id, ...form }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save review')
      setSavedAt(data.review?.reviewed_at ?? new Date().toISOString())
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save review')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Payment vetting review
            </h3>
            <p className="truncate text-xs text-gray-500">{doc.file_name || 'Report'}</p>
          </div>
          <div className="flex items-center gap-2">
            {doc.url && (
              <a
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                Open PDF
              </a>
            )}
            <button
              onClick={onClose}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
          {/* Report shown inline in the portal */}
          <div className="min-h-0 border-b border-gray-200 bg-gray-50 lg:border-b-0 lg:border-r">
            {doc.url ? (
              <iframe title="Vetting report" src={doc.url} className="h-full w-full" />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                Report not available
              </div>
            )}
          </div>

          {/* Structured payment-confirmation call form */}
          <div className="min-h-0 overflow-y-auto p-5">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Spinner size={16} /> Loading…
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Payment confirmation call
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input label="Load / Pro #" value={form.load_number} onChange={(e) => set('load_number', e.target.value)} />
                  <Input label="Date of factor" value={form.date_of_factor} onChange={(e) => set('date_of_factor', e.target.value)} />
                  <Input label="Factor phone #" value={form.factor_phone} onChange={(e) => set('factor_phone', e.target.value)} />
                  <Input label="Contact name" value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} />
                  <Input label="Contact dept / position" value={form.contact_dept} onChange={(e) => set('contact_dept', e.target.value)} />
                  <Input label="Call date & time" value={form.call_datetime} onChange={(e) => set('call_datetime', e.target.value)} placeholder="e.g. 7/23 2:15 PM" />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-gray-600">Remit-to &amp; bank details confirmed?</span>
                    <select
                      value={form.remit_confirmed}
                      onChange={(e) => set('remit_confirmed', e.target.value)}
                      className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    >
                      <option value="">—</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="not confirmed">Not confirmed</option>
                      <option value="pending">Pending</option>
                    </select>
                  </label>
                  <Input label="Confirmed by (DTS staff)" value={form.confirmed_by} onChange={(e) => set('confirmed_by', e.target.value)} />
                </div>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">Decision</span>
                  <select
                    value={form.decision}
                    onChange={(e) => set('decision', e.target.value)}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">—</option>
                    <option value="ok_to_pay">OK to pay</option>
                    <option value="hold">Hold</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">Notes / who was reached</span>
                  <textarea
                    value={form.notes}
                    onChange={(e) => set('notes', e.target.value)}
                    rows={5}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="Log the call outcome, who confirmed the remit-to and banking details, and any follow-up."
                  />
                </label>

                <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-3">
                  <Button onClick={save} disabled={saving}>
                    {saving ? <Spinner size={14} className="text-white" /> : null}
                    {saving ? 'Saving…' : 'Save review'}
                  </Button>
                  {savedAt && !saving && (
                    <span className="text-xs text-green-700">Saved · logged to activity</span>
                  )}
                  {error && <span className="text-sm text-red-700">{error}</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
