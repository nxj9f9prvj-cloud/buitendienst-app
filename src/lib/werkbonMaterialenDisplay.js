const BTW_RATE = 0.21

function toText(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v).trim()
  return ''
}

export function safeJsonParseArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  const s = String(value).trim()
  if (!s) return []
  try {
    const parsed = JSON.parse(s)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Regels + totalen (ex BTW, BTW 21%, incl.) voor weergave op werkbon. */
export function mapWerkbonMaterialen(werkbon) {
  const materieelFromDb = Array.isArray(werkbon?.materieel) ? werkbon.materieel : []
  const materialenRaw = safeJsonParseArray(werkbon?.materialen)

  let lines = []
  if (materieelFromDb.length > 0) {
    lines = materieelFromDb.map((m) => {
      const a = m?.artikel
      const omschrijving = toText(a?.omschrijving) || '—'
      const artikelnummer = toText(a?.artikelnummer) || toText(a?.artikel_nummer) || toText(a?.code) || ''
      const aantal = m?.aantal != null ? Number(m.aantal) : null
      const eenheid = toText(a?.eenheid) || 'stuk'
      const prijs = a?.prijs != null ? Number(a.prijs) : null
      const qty = aantal != null && Number.isFinite(aantal) ? aantal : 1
      const totaal = prijs != null && Number.isFinite(qty) ? qty * prijs : null
      return { naam: omschrijving, artikelnummer, aantal: aantal != null ? String(aantal) : '—', eenheid, prijs, totaal }
    })
  } else if (Array.isArray(materialenRaw) && materialenRaw.length > 0) {
    lines = materialenRaw
      .map((m) => {
        if (typeof m === 'string') {
          const name = m.trim()
          return name ? { naam: name, artikelnummer: '', aantal: '', eenheid: '', prijs: null, totaal: null } : null
        }
        if (m && typeof m === 'object') {
          const naam =
            toText(m.naam) ||
            toText(m.item) ||
            toText(m.product) ||
            toText(m.omschrijving) ||
            toText(m.material) ||
            ''
          const qty = Number(m.qty ?? m.aantal ?? 1) || 1
          const prijs = m.prijs != null ? Number(m.prijs) : null
          const totaal = prijs != null && qty ? prijs * qty : (m.totaal != null ? Number(m.totaal) : null)
          if (!naam && !qty) return null
          return {
            naam: naam || '—',
            artikelnummer: toText(m.artikelnummer) || '',
            aantal: toText(m.aantal) || toText(m.qty) || String(qty),
            eenheid: toText(m.eenheid) || 'stuk',
            prijs,
            totaal,
          }
        }
        return null
      })
      .filter(Boolean)
  }

  const totalen = computeMaterialenTotalen(lines)
  return { lines, totalen, hasMaterieelBron: materieelFromDb.length > 0 }
}

export function computeMaterialenTotalen(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null
  const subtotaal = lines.reduce((acc, m) => acc + (m.totaal != null && Number.isFinite(Number(m.totaal)) ? Number(m.totaal) : 0), 0)
  if (subtotaal === 0) return null
  const btw = subtotaal * BTW_RATE
  const totaalIncl = subtotaal + btw
  return { subtotaal, btw, totaal: subtotaal + btw, btwLabel: 'BTW 21%' }
}

export function formatEuro(amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return '—'
  return `€ ${Number(amount).toFixed(2)}`
}

/** Zelfde vorm als useWerkbonnen.getWerkbonByIdWithMaterieel */
export const WERKBON_MATERIEEL_SELECT = 'materieel:werkbon_materieel(*, artikel:artikelen(*))'

export async function fetchWerkbonMaterialenSnapshot(supabase, werkbonId, organisatieId) {
  if (!werkbonId) return { data: null, error: new Error('Geen werkbon-id') }
  let q = supabase
    .from('werkbonnen')
    .select(`id, werkbonnummer, materialen, ${WERKBON_MATERIEEL_SELECT}`)
    .eq('id', werkbonId)
  if (organisatieId) q = q.eq('organisatie_id', organisatieId)
  return q.single()
}
