/**
 * Controleert of een werkbon alle verplichte velden heeft ingevuld
 * voor "Klaar" / "Stuur naar klant".
 * Gebruikt in WerkbonEditModal (alleVerplichteVeldenIngevuld) en in
 * DashboardWerkbonDetail, OutlookPlanningBoard, WerkbonVijverPage voor "Stuur naar klant".
 *
 * Opties:
 * - materiaalVerplicht: bij true (standaard) moet er minstens één materiaalregel zijn; bij false mag "Stuur naar klant" zonder materialen.
 */

function trim(s) {
  return String(s ?? '').trim()
}

function isTruthyBoolean(value) {
  return value === true || String(value ?? '').toLowerCase().trim() === 'true'
}

function normalizeLabel(label) {
  return trim(label).toLowerCase()
}

export function isContractWerkbonLabel(label) {
  const normalized = normalizeLabel(label)
  if (!normalized) return false
  // Match alleen echte contract-labels en voorkom false positives zoals "arbeidscontract".
  return /(^|[\s_-])contract(?:bon)?($|[\s_-])/.test(normalized)
}

/**
 * Contractregel: rapportage naar opdrachtgever mag alleen als vervolgwerk noodzakelijk is.
 * @param {object} werkbon
 * @returns {boolean}
 */
export function magRapportageNaarOpdrachtgever(werkbon) {
  if (!isContractWerkbonLabel(werkbon?.label)) return true
  return isTruthyBoolean(werkbon?.vervolg_nodig)
}

function safeJsonParseArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  const s = trim(value)
  if (!s) return []
  try {
    const parsed = JSON.parse(s)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * @param {object} werkbon - Werkbon met optioneel klant, materieel, materialen
 * @param {{ materiaalVerplicht?: boolean }} [opts] - materiaalVerplicht: voor "Stuur naar klant" false (mag zonder materialen)
 * @returns {boolean}
 */
export function werkbonVoldoetAanVerplichteVelden(werkbon, opts = {}) {
  if (!werkbon) return false

  const { materiaalVerplicht = true } = opts

  const heeftKlant = !!werkbon.klant_id
  const klant = werkbon.klant
  const emailWerkbon = trim(klant?.email_werkbon ?? klant?.email)
  const heeftWerkbonMail = !!emailWerkbon

  const werkadresGelijk = !!werkbon.werkadres_gelijk_aan_vestiging
  const klantHasAdres =
    !!klant &&
    (trim(klant.straat) || trim(klant.postcode)) &&
    (trim(klant.huisnummer) || trim(klant.plaats))
  const werkHasAdres =
    (trim(werkbon.werk_postcode) && trim(werkbon.werk_huisnummer)) || trim(werkbon.werk_straat)
  const heeftWerkadres = werkadresGelijk ? !!klantHasAdres : !!werkHasAdres

  const heeftWerkomschrijving = !!trim(werkbon.werkomschrijving)
  const heeftPlanning = !!trim(werkbon.plandatum)
  const heeftBevindingen = !!trim(werkbon.bevindingen)
  const heeftKlantreferentie = !!trim(werkbon.klantreferentie)
  const statusKlaar = String(werkbon.status ?? '').toLowerCase().trim() === 'klaar'
  const heeftGereedOfVervolg = !!(werkbon.klus_gereed || isTruthyBoolean(werkbon.vervolg_nodig) || statusKlaar)

  const materieel = werkbon.materieel || []
  const materialenJson = werkbon.materialen
  const materialenList = Array.isArray(materieel)
    ? materieel
    : safeJsonParseArray(materialenJson)
  const heeftMateriaal =
    materialenList.length > 0 &&
    materialenList.some(
      (m) => (m.artikel_id || m.artikel) && (Number(m.aantal) > 0 || m.aantal === undefined)
    )

  const basis =
    heeftKlant &&
    heeftWerkbonMail &&
    heeftWerkadres &&
    heeftWerkomschrijving &&
    heeftPlanning &&
    heeftBevindingen &&
    heeftKlantreferentie &&
    heeftGereedOfVervolg

  if (!materiaalVerplicht) return basis
  return basis && heeftMateriaal
}
