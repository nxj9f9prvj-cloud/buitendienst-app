export function normalizeWerkbonStatus(status) {
  const s = String(status || '').toLowerCase().trim()

  if (s === 'ingepland') return 'gepland'

  return s
}
