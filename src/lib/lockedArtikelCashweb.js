/** Client-side spiegel van PROTECTED_ARB_ARTIKELNUMMERS (send-artikel / verkooporder guards). */
const PROTECTED_ARB_ARTIKELNUMMERS = new Set([
  '0030', '0045', '0060', '0075', '0090', '0105', '0120', '0135', '0150', '0165',
  '0180', '0195', '0210', '0225', '0240', '0255', '0270', '0285', '0300', '0315',
  '0330', '0345', '0360', '0375', '0390', '0405', '0420', '0435', '0450', '0465',
  '0480', '1103', '1110', '1111', '1115', '1117',
])

export function normalizeArtikelcodeForLock(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (/^\d+$/.test(raw)) {
    if (raw.length <= 4) return String(Number(raw)).padStart(4, '0')
    return String(Number(raw))
  }
  return raw.toUpperCase()
}

export function isProtectedArbArtikelnummer(value) {
  const normalized = normalizeArtikelcodeForLock(value)
  if (!normalized) return false
  if (PROTECTED_ARB_ARTIKELNUMMERS.has(normalized)) return true
  if (/^\d+$/.test(normalized)) {
    const stripped = String(Number(normalized))
    return PROTECTED_ARB_ARTIKELNUMMERS.has(stripped) || PROTECTED_ARB_ARTIKELNUMMERS.has(stripped.padStart(4, '0'))
  }
  return false
}

export function isArtikelExportBlockedLocally(artikel) {
  if (!artikel) return false
  if (artikel.stam_locked) return true
  const code = artikel.artikelnummer ?? artikel.artikel_nummer ?? ''
  return isProtectedArbArtikelnummer(code)
}

export function buildLockedArtikelExportBlockMessage(codes) {
  const list = (Array.isArray(codes) ? codes : []).map((c) => String(c ?? '').trim()).filter(Boolean)
  if (list.length === 0) return 'Dit artikel mag niet vanuit Montiqu naar CASH als stam worden geëxporteerd.'
  if (list.length === 1) {
    return `Artikelnummer ${list[0]} is beschermd en mag niet vanuit Montiqu naar CASH als stam worden geëxporteerd.`
  }
  return `Deze artikelnummers zijn beschermd en mogen niet vanuit Montiqu naar CASH als stam worden geëxporteerd: ${list.join(', ')}.`
}

export function buildLockedArtikelVerkooporderConfirmMessage(payload) {
  const codes = Array.isArray(payload?.blocked_locked_artikelcodes)
    ? payload.blocked_locked_artikelcodes
    : Array.isArray(payload?.missing_artikelcodes)
      ? payload.missing_artikelcodes
      : []
  const preview = codes.map((c) => String(c ?? '').trim()).filter(Boolean)
  if (preview.length === 0) {
    return (
      'Een of meer beschermde artikelen ontbreken in CASH. Doorgaan kan CASH ze als nieuw MATR-artikel aanmaken. Toch doorgaan?'
    )
  }
  const label = preview.length === 1 ? `Artikelnummer ${preview[0]}` : `Artikelnummers ${preview.join(', ')}`
  return (
    `${label} ontbreekt in CASH en is in Montiqu beschermd (gelocked/vaste ARB-stam). ` +
    'Doorgaan met de verkooporder kan CASH dit alsnog als nieuw MATR-artikel aanmaken. Toch doorgaan?'
  )
}

export async function promptLockedArtikelVerkooporderExport(payload) {
  const message = buildLockedArtikelVerkooporderConfirmMessage(payload)
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return window.confirm(message)
  }
  return false
}

export function isVerkooporderCashExportCancelled(cashRes) {
  return !!cashRes?.cancelled
}

export function verkooporderCashExportStatusFromResult(cashRes) {
  if (isVerkooporderCashExportCancelled(cashRes)) {
    return 'geannuleerd: beschermd artikel ontbreekt in CASH'
  }
  const confirmed = cashRes?.acknowledged !== false
  if (cashRes?.success) return confirmed ? 'bevestigd' : 'onbevestigd'
  return `mislukt: ${String(cashRes?.error || 'onbekend').slice(0, 200)}`
}
