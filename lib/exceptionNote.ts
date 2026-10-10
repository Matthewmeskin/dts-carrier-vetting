// Shared by the checklist (client) and the exception gate (server).

/**
 * True when the note says, in the reviewer's words, why the carrier was
 * approved. Free text is fine. If the optional prefill was used, its "why"
 * placeholder must have been replaced; the other placeholders may stay.
 */
export function noteIsFilled(note: string | null | undefined): boolean {
  const t = (note ?? '').trim()
  if (t.length < 10) return false
  if (/\[Describe why this carrier is still appropriate/i.test(t)) return false
  return true
}
