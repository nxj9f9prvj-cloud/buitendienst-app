const eurFormatter = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

/**
 * Labeltekst voor <option> en vergelijkbare lijsten: omschrijving / artikelnummer + prijs (EUR, nl-NL).
 * @param {object|null|undefined} artikel — verwacht o.a. omschrijving, artikelnummer of artikel_nummer, prijs, eenheid, actief
 * @param {{ showInactive?: boolean }} [opts] — standaard "(inactief)" bij actief === false
 */
export function formatArtikelOptionLabel(artikel, opts = {}) {
  if (!artikel) return ''
  const { showInactive = true } = opts
  const num = String(artikel.artikelnummer ?? artikel.artikel_nummer ?? '').trim()
  const oms = String(artikel.omschrijving ?? '').trim()

  let primary
  if (oms && num) primary = `${oms} (${num})`
  else if (oms) primary = oms
  else if (num) primary = num
  else primary = String(artikel.id ?? '')

  const rawPrijs = artikel.prijs
  const prijsNum = rawPrijs != null && rawPrijs !== '' ? Number(rawPrijs) : NaN
  let prijsStr
  if (Number.isFinite(prijsNum)) {
    prijsStr = eurFormatter.format(prijsNum)
    const een = String(artikel.eenheid ?? '').trim()
    if (een && een.toLowerCase() !== 'stuk') prijsStr += `/${een}`
  } else {
    prijsStr = '—'
  }

  let out = `${primary} — ${prijsStr}`
  if (showInactive && artikel.actief === false) out += ' (inactief)'
  return out
}
