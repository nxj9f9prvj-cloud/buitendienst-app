import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useErpRole } from '../auth/useErpRole'

/** Normaliseer een artikelrij: ondersteun zowel camelCase als snake_case kolomnamen uit Supabase. */
function normalizeArtikel(row) {
  if (!row) return row
  return {
    ...row,
    artikelnummer: row.artikelnummer ?? row.artikel_nummer ?? null,
    stam_locked: row.stam_locked === true,
  }
}

/**
 * Artikelen/materiaallijst voor facturatie en werkbonnen.
 * Gebruikt tabel: artikelen (verwacht: id, omschrijving, actief, artikelnummer of artikel_nummer, prijs, eenheid, etc.)
 */
export function useArtikelen({ includeInactive = false } = {}) {
  const { organisatieId } = useErpRole()
  const [artikelen, setArtikelen] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)
  const artikelNummerKeyRef = useRef('artikelnummer')
  const pageSize = 1000

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchArtikelen = useCallback(async () => {
    if (!mountedRef.current) return
    setLoading(true)
    setError(null)
    try {
      const raw = []
      let from = 0

      while (true) {
        let q = supabase.from('artikelen').select('*').range(from, from + pageSize - 1)
        if (!includeInactive) {
          q = q.eq('actief', true)
        }
        if (organisatieId) q = q.eq('organisatie_id', organisatieId)
        const { data, error: qError } = await q
        if (qError) throw qError
        const chunk = data || []
        raw.push(...chunk)
        if (chunk.length < pageSize) break
        from += pageSize
      }

      if (raw.length > 0 && raw[0] != null && Object.prototype.hasOwnProperty.call(raw[0], 'artikel_nummer') && !Object.prototype.hasOwnProperty.call(raw[0], 'artikelnummer')) {
        artikelNummerKeyRef.current = 'artikel_nummer'
      } else {
        artikelNummerKeyRef.current = 'artikelnummer'
      }
      const sorted = raw.slice().sort((a, b) => {
        const aa = String(a?.omschrijving ?? '').toLowerCase()
        const bb = String(b?.omschrijving ?? '').toLowerCase()
        return aa.localeCompare(bb)
      })
      if (mountedRef.current) setArtikelen(sorted.map(normalizeArtikel))
    } catch (err) {
      if (mountedRef.current) {
        setError(err)
        setArtikelen([])
      }
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [includeInactive, organisatieId])

  useEffect(() => {
    fetchArtikelen()
    const channel = supabase
      .channel('artikelen_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'artikelen' }, () => {
        fetchArtikelen()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchArtikelen])

  const insertArtikel = useCallback(async (row) => {
    const payload = { ...row }
    if (artikelNummerKeyRef.current !== 'artikelnummer' && payload.artikelnummer !== undefined) {
      payload[artikelNummerKeyRef.current] = payload.artikelnummer
      delete payload.artikelnummer
    }
    if (organisatieId) payload.organisatie_id = organisatieId
    const { data, error: insError } = await supabase
      .from('artikelen')
      .insert([payload])
      .select()
      .single()
    if (insError) throw insError
    fetchArtikelen()
    return data
  }, [fetchArtikelen, organisatieId])

  const updateArtikel = useCallback(async (id, updates) => {
    const payload = { ...updates }
    if (artikelNummerKeyRef.current !== 'artikelnummer' && payload.artikelnummer !== undefined) {
      payload[artikelNummerKeyRef.current] = payload.artikelnummer
      delete payload.artikelnummer
    }
    let updateQ = supabase.from('artikelen').update(payload).eq('id', id)
    if (organisatieId) updateQ = updateQ.eq('organisatie_id', organisatieId)
    const { data, error: updError } = await updateQ.select().single()
    if (updError) throw updError
    fetchArtikelen()
    return data
  }, [fetchArtikelen, organisatieId])

  const deleteArtikel = useCallback(async (id) => {
    let delQ = supabase.from('artikelen').delete().eq('id', id)
    if (organisatieId) delQ = delQ.eq('organisatie_id', organisatieId)
    const { error: delError } = await delQ
    if (delError) throw delError
    fetchArtikelen()
  }, [fetchArtikelen, organisatieId])

  return {
    artikelen,
    loading,
    error,
    fetchArtikelen,
    insertArtikel,
    updateArtikel,
    deleteArtikel,
  }
}
