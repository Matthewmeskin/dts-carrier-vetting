'use client'

import { EXCEPTION_NOTE_TEMPLATE } from '@/lib/vettingChecklist'
import { Textarea } from './ui/Input'
import { Button } from './ui/Button'

export function ExceptionNoteComposer({
  value,
  onChange,
  carrierName,
  dotNumber,
}: {
  value: string
  onChange: (v: string) => void
  carrierName?: string | null
  dotNumber: string
}) {
  function prefill() {
    const filled = EXCEPTION_NOTE_TEMPLATE.replace(
      '[CARRIER NAME]',
      carrierName || '[CARRIER NAME]'
    )
      .replace('[DOT NUMBER]', dotNumber)
      .replace('[DATE]', new Date().toLocaleDateString())
    onChange(filled)
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-amber-900">
            Exception note
          </h4>
          <p className="text-xs text-amber-700">
            Required when any baseline preference is not satisfied. Document the
            issue, review performed, mitigating factors, controls, and approver.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={prefill}
          disabled={value.trim().length > 0}
        >
          Prefill template
        </Button>
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={14}
        placeholder="Click “Prefill template” to start from the standard exception note format."
        className="font-mono text-xs"
      />
    </div>
  )
}
