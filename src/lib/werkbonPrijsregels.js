import { buildArtikelenById, resolveArtikelForMaterieelRow } from './artikelMaterieelRows.js'
import { safeJsonParseArray } from './werkbonMaterialenDisplay.js'

function normalizeLabel(label) {
  return String(label ?? '').trim().toLowerCase()
}

/** Positieve prijs uit artikelstam (artikelen.prijs). */
export function artikelHeeftPositievePrijs(artikel) {
  if (!artikel) return false
  const prijs = Number(artikel.prijs)
  return Number.isFinite(prijs) && prijs > 0
}

function materieelRegelHeeftArtikelMetPrijs(regel, artikelenById, materieelFallback) {
  const artikelId = regel?.artikel_id ?? regel?.artikel?.id
  if (!artikelId) return false
  const aantal = regel?.aantal
  if (aantal != null && !(Number(aantal) > 0)) return false
  const artikel = regel?.artikel ?? resolveArtikelForMaterieelRow(regel, artikelenById, materieelFallback)
  return artikelHeeftPositievePrijs(artikel)
}

/**
 * Prijsafspraak-bon: minstens één materiaalregel met artikel uit stam met prijs > 0.
 * @param {object} werkbon
 * @param {{ materieelRows?: Array, artikelen?: Array }} [opts]
 */
export function werkbonHeeftMaterieelMetPrijs(werkbon, opts = {}) {
  if (!werkbon) return false
  if (!isPrijsafspraakWerkbon(werkbon)) return true

  const { materieelRows, artikelen } = opts
  const materieelFallback = werkbon?.materieel
  const artikelenById = Array.isArray(artikelen) ? buildArtikelenById(artikelen) : null

  if (Array.isArray(materieelRows) && materieelRows.length > 0 && artikelenById) {
    if (materieelRows.some((r) => materieelRegelHeeftArtikelMetPrijs(r, artikelenById, materieelFallback))) {
      return true
    }
  }

  const materieel = Array.isArray(werkbon?.materieel) ? werkbon.materieel : []
  if (materieel.some((m) => materieelRegelHeeftArtikelMetPrijs(m, null, materieelFallback))) {
    return true
  }

  const materialenJson = safeJsonParseArray(werkbon?.materialen)
  return materialenJson.some((m) => {
    if (!m || typeof m !== 'object') return false
    const artikelId = m.artikel_id ?? m.artikel?.id
    const artikelnummer = String(m.artikelnummer ?? m.artikel_nummer ?? '').trim()
    if (!artikelId && !artikelnummer) return false
    const qty = Number(m.qty ?? m.aantal ?? 1)
    if (!(qty > 0)) return false
    if (m.artikel && artikelHeeftPositievePrijs(m.artikel)) return true
    const prijs = Number(m.prijs)
    return Number.isFinite(prijs) && prijs > 0
  })
}

export const PRIJSAFSPRAAK_INPLAN_BLOKKEER_MELDING =
  'Geen artikel ingevuld, vul artikel in voor je een bon inplant'

export function getPrijsafspraakInplanBlokkeringsMelding() {
  return PRIJSAFSPRAAK_INPLAN_BLOKKEER_MELDING
}

/**
 * @param {object} werkbon
 * @param {{ materieelRows?: Array, artikelen?: Array }} [opts]
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function assertKanPrijsafspraakInplannen(werkbon, opts = {}) {
  if (werkbonHeeftMaterieelMetPrijs(werkbon, opts)) return { ok: true }
  return { ok: false, message: getPrijsafspraakInplanBlokkeringsMelding() }
}

export function isPrijsafspraakInplanDbError(error) {
  const msg = String(error?.message ?? error ?? '')
  return msg.includes('PRIJSAFSPRAAK_GEEN_MATERIEEL_MET_PRIJS')
}

export function formatPrijsafspraakInplanError(error) {
  if (isPrijsafspraakInplanDbError(error)) return getPrijsafspraakInplanBlokkeringsMelding()
  return String(error?.message ?? error ?? 'Onbekende fout')
}

export function isPrijsafspraakWerkbon(werkbon) {
  return normalizeLabel(werkbon?.label) === 'prijsafspraak'
}

export function isContractWerkbon(werkbon) {
  const label = normalizeLabel(werkbon?.label)
  return label === 'contract' || label === 'contractbon'
}

export function isOfferteWerkbon(werkbon) {
  return normalizeLabel(werkbon?.label) === 'offertebon'
}

export function isOpnameWerkbon(werkbon) {
  return normalizeLabel(werkbon?.label).includes('opname')
}

export function magVoorrijkostenToepassen(werkbon) {
  return !isPrijsafspraakWerkbon(werkbon)
}

export function magArbeidsloonAutomatischToevoegen(werkbon) {
  return !isPrijsafspraakWerkbon(werkbon)
}

/** Vinkje 2e man in buitendienst (niet bij opname/prijsafspraak). */
export function magTweedeManArbeidsloonKiezen(werkbon) {
  return magArbeidsloonAutomatischToevoegen(werkbon) && !isOpnameWerkbon(werkbon)
}

/** Aantal op de automatische arbeidsloonregel bij sync (1 of 2). */
export function getArbeidsloonSyncAantal(werkbon) {
  if (!magTweedeManArbeidsloonKiezen(werkbon)) return 1
  return werkbon?.arbeidsloon_tweede_man === true ? 2 : 1
}

export function toonUrenregistratieOpRapport(werkbon) {
  return !isPrijsafspraakWerkbon(werkbon)
}

export function magBrandstoftoeslagToepassen(werkbon, settings = {}) {
  const enabled = settings?.enabled === true
  if (!enabled) return false
  if (isContractWerkbon(werkbon)) return false
  return true
}
