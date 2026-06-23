import { useMemo, useState } from 'react'

/** Filter artikelen op omschrijving of artikelnummer (client-side). */
export function filterArtikelen(artikelen, query) {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return artikelen || []
  return (artikelen || []).filter((a) => {
    const oms = String(a?.omschrijving ?? '').toLowerCase()
    const nr = String(a?.artikelnummer ?? a?.artikel_nummer ?? '').toLowerCase()
    return oms.includes(q) || nr.includes(q)
  })
}

/**
 * Zoekstate + gefilterde artikelen voor picker-componenten.
 * @param {Array} artikelen
 * @param {{ maxResults?: number }} [opts]
 */
export function useArtikelSearch(artikelen, { maxResults = 20 } = {}) {
  const [search, setSearch] = useState('')
  const filteredArtikelen = useMemo(() => filterArtikelen(artikelen, search), [artikelen, search])
  const visibleResults = useMemo(() => filteredArtikelen.slice(0, maxResults), [filteredArtikelen, maxResults])
  const hasSearch = String(search ?? '').trim().length > 0

  return {
    search,
    setSearch,
    filteredArtikelen,
    visibleResults,
    hasSearch,
    clearSearch: () => setSearch(''),
  }
}
