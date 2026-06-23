/** Map artikel-id → artikel voor snelle lookup in materiaalregels. */
export function buildArtikelenById(artikelen) {
  const map = new Map()
  for (const a of artikelen || []) {
    if (a?.id) map.set(a.id, a)
  }
  return map
}

/** Label voor materiaalregel: eerst actuele lijst, anders embedded artikel op werkbon. */
export function resolveArtikelForMaterieelRow(row, artikelenById, werkbonMaterieel) {
  if (!row?.artikel_id) return null
  const fromList = artikelenById?.get?.(row.artikel_id) ?? artikelenById?.[row.artikel_id]
  if (fromList) return fromList
  const fromWb = (werkbonMaterieel || []).find(
    (m) => String(m.artikel_id ?? m.artikel?.id ?? '') === String(row.artikel_id)
  )
  return fromWb?.artikel ?? null
}
