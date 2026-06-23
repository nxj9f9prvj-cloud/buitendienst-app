export function formatDateNL(dateLike) {
  if (!dateLike) return ''

  const d = new Date(dateLike)
  if (isNaN(d)) return ''

  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()

  return `${day}-${month}-${year}`
}

/** Datum + tijd voor logboek (bijv. "28-01-2026 09:15"). */
export function formatDateTimeNL(dateLike) {
  if (!dateLike) return ''
  const d = new Date(dateLike)
  if (isNaN(d)) return ''
  const dateStr = formatDateNL(d)
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${dateStr} ${hours}:${minutes}`
}
