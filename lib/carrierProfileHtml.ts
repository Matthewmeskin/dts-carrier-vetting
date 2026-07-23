import type { CarrierContext } from '@/lib/carrierContext'
import { formatDate, formatDateTime } from '@/lib/utils'

// Build a print-friendly, standalone Carrier Profile HTML page from the carrier
// context. Rendered to PDF (via the PDF service) and appended to the payment
// vetting report so the file bundles a full profile snapshot.
export function buildCarrierProfileHtml(
  ctx: CarrierContext,
  opts?: { mapsKey?: string | null }
): string {
  const c = ctx.carrier || {}
  const addr = ctx.physical_address || {}
  const auth = ctx.authority || {}
  const ins = ctx.insurance || {}
  const id = ctx.identity || {}
  const fac = ctx.factoring || {}
  const factor = ctx.factor || {}
  const sos = ctx.sos || {}
  const noa = ctx.noa || {}

  const esc = (v: any): string => {
    if (v === null || v === undefined || v === '') return '&mdash;'
    return String(v)
      .split('&')
      .join('&amp;')
      .split('<')
      .join('&lt;')
      .split('>')
      .join('&gt;')
  }
  const yn = (v: any): string => (v === true ? 'YES' : v === false ? 'NO' : '&mdash;')
  const fld = (l: string, v: any): string =>
    `<tr><td class="l">${l}</td><td class="v">${esc(v)}</td></tr>`
  // Like fld but the value is trusted HTML (e.g. a link).
  const fldRaw = (l: string, v: string): string =>
    `<tr><td class="l">${l}</td><td class="v">${v || '&mdash;'}</td></tr>`
  const addrStr = [addr.street, [addr.city, addr.state, addr.zip].filter(Boolean).join(' ')]
    .filter((p) => p && String(p).trim())
    .join(', ')

  // Secretary-of-State search link for the carrier (state SoS business search).
  const sosName = String(c.legal_name || '')
  const sosState = String(addr.state || '').trim()
  const sosSearchLink = sosName
    ? `<a href="https://www.google.com/search?q=${encodeURIComponent(
        sosName + ' ' + sosState + ' secretary of state business entity search'
      )}">Search ${esc(sosState)} Secretary of State</a>`
    : '&mdash;'
  const hardStops =
    Array.isArray(ins.hard_stops) && ins.hard_stops.length
      ? ins.hard_stops.join('; ')
      : 'none'

  // Satellite + Street View of the physical address, rendered into the PDF.
  const mapsKey = opts?.mapsKey || null
  let locationSection = ''
  if (mapsKey && addrStr) {
    const enc = encodeURIComponent(addrStr)
    const sat = `https://maps.googleapis.com/maps/api/staticmap?center=${enc}&zoom=19&size=640x360&scale=2&maptype=satellite&markers=color:red%7C${enc}&key=${mapsKey}`
    const sv = `https://maps.googleapis.com/maps/api/streetview?size=640x360&location=${enc}&fov=80&pitch=0&source=outdoor&key=${mapsKey}`
    const mapsLink = `https://www.google.com/maps/search/?api=1&query=${enc}`
    locationSection =
      '<div class="sec">Location (FMCSA-registered physical address)</div>' +
      `<div class="sub">${esc(addrStr)}${addr.source ? ' &middot; ' + esc(addr.source) : ''} &middot; <a href="${mapsLink}">Open in Google Maps</a></div>` +
      '<div class="cols"><div>' +
      `<div class="cap">Satellite</div><img class="map" src="${sat}" alt="Satellite view" />` +
      '</div><div>' +
      `<div class="cap">Street View</div><img class="map" src="${sv}" alt="Street View" />` +
      '</div></div>'
  }

  // The NOA verification is stored as a JSON object; render a readable one-liner
  // rather than "[object Object]".
  const noaRes: any = (noa && (noa as any).result) || null
  let noaResultStr: string | null = null
  if (noaRes) {
    const nameMismatch = noaRes.carrier_name_matches === false
    const clean =
      noaRes.is_noa &&
      !nameMismatch &&
      noaRes.assignee_matches_factor &&
      noaRes.payto_address_match === 'match' &&
      Array.isArray(noaRes.discrepancies) &&
      noaRes.discrepancies.length === 0
    const head = !noaRes.is_noa
      ? 'Not a NOA'
      : nameMismatch
        ? 'FLAG — NOA names a different carrier'
        : clean
          ? 'Verified — assignee & pay-to match'
          : `Reviewed — ${(noaRes.discrepancies || []).length} discrepancy(ies)`
    noaResultStr = head + (noaRes.summary ? ' — ' + noaRes.summary : '')
  }

  const style =
    '*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;font-size:12px;margin:0;padding:24px}h1{font-size:18px;margin:0 0 2px}.sub{color:#666;font-size:11px;margin-bottom:10px}table{border-collapse:collapse;width:100%;margin:6px 0}td{padding:4px 6px;border:1px solid #e2e2e2;vertical-align:top}td.l{background:#f6f6f6;font-weight:bold;width:45%}.sec{font-weight:bold;color:#00547f;margin:14px 0 4px;font-size:13px;border-bottom:2px solid #00547f;padding-bottom:2px}.cols{display:flex;gap:16px}.cols>div{flex:1}img.map{width:100%;height:auto;border:1px solid #e2e2e2;border-radius:4px}.cap{font-size:11px;color:#666;margin:2px 0}'

  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    style +
    '</style></head><body>' +
    `<h1>Carrier Profile — ${esc(c.legal_name || 'DOT ' + (c.dot_number || ''))}</h1>` +
    `<div class="sub">DTS Carrier Compliance Portal · DOT ${esc(c.dot_number)} · Status ${esc(c.carrier_status)}</div>` +
    '<div class="sec">Business &amp; contact</div>' +
    '<div class="cols"><div><table>' +
    fld('Legal name', c.legal_name) +
    fld('DBA', c.dba_name) +
    fld('DOT #', c.dot_number) +
    fld('MC #', c.mc_number) +
    fld('Phone', c.phone) +
    fld('Email', c.email) +
    '</table></div><div><table>' +
    fld('Physical address', addrStr || null) +
    fld('Address source', addr.source) +
    fld('Intrastate only', yn(c.is_intrastate)) +
    fld('Portal status', c.carrier_status) +
    fld('Do not use', yn(c.do_not_use)) +
    fld('DNU reason', c.do_not_use_reason) +
    '</table></div></div>' +
    '<div class="sec">Authority &amp; safety</div>' +
    '<div class="cols"><div><table>' +
    fld('Operating status', auth.operating_status) +
    fld('Contract authority', auth.contract_authority_status) +
    fld('Authority granted', auth.authority_original_date ? formatDate(auth.authority_original_date) : null) +
    fld('Authority age (days)', auth.authority_days_active) +
    '</table></div><div><table>' +
    fld('Safety rating', c.safety_rating) +
    fld('RMIS certified', yn(ins.rmis_is_certified)) +
    fld('RMIS last pulled', ins.fetched_at ? formatDateTime(ins.fetched_at) : null) +
    fld('Hard stops', hardStops) +
    '</table></div></div>' +
    locationSection +
    '<div class="sec">Insurance</div>' +
    '<table>' +
    fld('Auto liability', (ins.auto_status || '—') + (ins.auto_expiration_date ? ' · exp ' + formatDate(ins.auto_expiration_date) : '')) +
    fld('Cargo', (ins.cargo_status || '—') + (ins.cargo_expiration_date ? ' · exp ' + formatDate(ins.cargo_expiration_date) : '')) +
    fld('General liability', (ins.general_status || '—') + (ins.general_expiration_date ? ' · exp ' + formatDate(ins.general_expiration_date) : '')) +
    '</table>' +
    '<div class="sec">Compliance documents</div>' +
    '<div class="cols"><div><table>' +
    fld('W-9 on file', yn(id.w9_on_file)) +
    // RMIS only returns the itemized W-9 fields when the carrier filled them into
    // the structured W-9 section. When the W-9 is on file only as an uploaded PDF,
    // those fields come back blank — show that plainly instead of empty rows that
    // read as missing data.
    ((id.w9_on_file && !id.w9_business_name && !id.w9_company_type && !id.w9_tax_id_last4)
      ? fld('W-9 details', 'On file as uploaded document — not itemized in RMIS')
      : fld('W-9 business name', id.w9_business_name) +
        fld('W-9 type', id.w9_company_type) +
        fld('W-9 tax ID', id.w9_tax_id_last4 ? 'ending ' + id.w9_tax_id_last4 : null)) +
    '</table></div><div><table>' +
    fld('Broker-carrier agreement', yn(id.bca_on_file)) +
    fld('Agreement date', id.bca_date ? formatDate(id.bca_date) : null) +
    '</table></div></div>' +
    '<div class="sec">Business registration (SOS)</div>' +
    '<table>' +
    fld('SOS status', sos.status || 'not checked') +
    fld('Entity type', sos.entity_type) +
    fld('Name match', sos.name_match) +
    fld('Principal address', sos.principal_address) +
    fld('Registered agent', sos.registered_agent) +
    (sos.summary ? fld('Summary', sos.summary) : '') +
    fldRaw('SoS search', sosSearchLink) +
    '</table>' +
    (fac.is_factoring === true
      ? '<div class="sec">Factoring</div><div class="cols"><div><table>' +
        fld('Factoring?', yn(fac.is_factoring)) +
        fld('Pay-to entity', fac.pay_to_entity) +
        fld('Pay-to address', fac.pay_to_address) +
        fld('Factor (registry)', factor.name) +
        fld('Factor approval', factor.approval_status) +
        '</table></div><div><table>' +
        fld('Factor SOS status', factor.sos_status_normalized) +
        fld('Factor SOS state', factor.sos_state) +
        fld('Factor SOS entity type', factor.sos_entity_type) +
        fld('Factor registered agent', factor.sos_registered_agent) +
        '</table></div></div>' +
        (factor.sos_summary ? '<table>' + fld('Factor SOS summary', factor.sos_summary) + '</table>' : '') +
        '<table>' +
        fld('NOA result', noaResultStr) +
        fld('NOA checked', noa.checked_at ? formatDateTime(noa.checked_at) : null) +
        '</table>'
      : '') +
    '<div class="sub" style="margin-top:16px">Generated from the DTS Carrier Compliance Portal.</div>' +
    '</body></html>'
  )
}
