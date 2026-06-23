import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useErpRole } from '../auth/useErpRole'

export const useWerkbonnen = ({ bucketLimit = 2000, enableRealtime = true } = {}) => {
  const { organisatieId } = useErpRole()
  const [werkbonnen, setWerkbonnen] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const mountedRef = useRef(true)
  const inFlightRef = useRef(false)
  const fetchSeqRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      console.log('useWerkbonnen: Component unmounting')
      mountedRef.current = false
    }
  }, [])

  const fetchWerkbonnen = useCallback(
    async ({ silent = false } = {}) => {
      if (!mountedRef.current) {
        console.log('useWerkbonnen: Component unmounted, skipping fetch')
        return
      }
      
      // Non-silent fetches: voorkom overlap
      if (!silent && inFlightRef.current) return

      // Token: alleen de laatste fetch mag state zetten
      const seq = ++fetchSeqRef.current

      if (!silent) inFlightRef.current = true
      if (!silent) setLoading(true)
      setError(null)

      try {
        console.log('useWerkbonnen: Starting fetch...', { silent })
        
        let q = supabase
          .from('werkbonnen')
          .select(
            `
          *,
          materialen,
          klant:klanten(*),
          medewerker:medewerkers!medewerker_id(*),
          werkbon_categorieen ( id, naam ),
          materieel:werkbon_materieel(*)
        `
          )
          .order('updated_at', { ascending: false })
          .limit(bucketLimit)
        if (organisatieId) q = q.eq('organisatie_id', organisatieId)
        const { data, error: qError } = await q

        if (qError) {
          console.error('useWerkbonnen: Supabase query error:', qError)
          throw qError
        }

        if (!mountedRef.current) return
        if (seq !== fetchSeqRef.current) {
          console.log('useWerkbonnen: Stale fetch result ignored')
          return
        }

        console.log(`useWerkbonnen: Successfully fetched ${data?.length || 0} werkbonnen`)
        
        // Debug: log statussen van opgehaalde werkbonnen
        const statusCounts = {}
        ;(data || []).forEach((w) => {
          const status = String(w?.status ?? '').trim()
          if (status) {
            statusCounts[status] = (statusCounts[status] || 0) + 1
          }
        })
        console.log('useWerkbonnen: Status overzicht van opgehaalde werkbonnen:', statusCounts)
        
        const klaarCount = (data || []).filter((w) => String(w?.status ?? '').toLowerCase().trim() === 'klaar').length
        console.log(`useWerkbonnen: Aantal werkbonnen met status "klaar": ${klaarCount}`)
        if (klaarCount > 0) {
          const eersteKlaar = (data || []).find((w) => String(w?.status ?? '').toLowerCase().trim() === 'klaar')
          console.log('useWerkbonnen: Eerste klaar werkbon:', {
            id: eersteKlaar?.id,
            werkbonnummer: eersteKlaar?.werkbonnummer,
            status: eersteKlaar?.status,
            statusLower: String(eersteKlaar?.status ?? '').toLowerCase().trim(),
            klus_gereed: eersteKlaar?.klus_gereed,
            vervolg_nodig: eersteKlaar?.vervolg_nodig,
            archived_at: eersteKlaar?.archived_at,
          })
        } else {
          console.log('useWerkbonnen: GEEN werkbonnen met status "klaar" gevonden in de opgehaalde data')
        }

        // Update state
        setWerkbonnen(data || [])
        setError(null)
      } catch (err) {
        if (!mountedRef.current) return
        if (seq !== fetchSeqRef.current) return

        console.error('useWerkbonnen: Error fetching werkbonnen:', err)

        // Check voor RLS policy errors
        if (err?.code === '42501' || err?.message?.includes('row-level security')) {
          setError(new Error('RLS Policy Error: Geen toegang tot werkbonnen. Controleer Supabase RLS policies.'))
        } else if (err?.status === 403 || err?.code === 'PGRST301') {
          setError(new Error('403 Forbidden: Geen toegang tot werkbonnen tabel. Controleer RLS policies.'))
        } else {
          setError(err)
        }
      } finally {
        if (!mountedRef.current) return
        // Non-silent fetches moeten altijd loading resetten – ook bij stale result.
        // Anders blijft "laden..." hangen als een silent fetch (updateWerkbon/realtime) de seq
        // verhoogt voordat deze fetch klaar is.
        if (!silent) {
          setLoading(false)
          inFlightRef.current = false
        }
      }
    },
    [bucketLimit, organisatieId]
  )

  const getWerkbonById = useCallback(async (id) => {
    try {
      let q = supabase
        .from('werkbonnen')
        .select(
          `
          *,
          klant:klanten(*),
          medewerker:medewerkers!medewerker_id(*),
          werkbon_categorieen ( id, naam )
        `
        )
        .eq('id', id)
      if (organisatieId) q = q.eq('organisatie_id', organisatieId)
      const { data, error: qError } = await q.single()

      if (qError) throw qError
      return data
    } catch (err) {
      console.error('Error fetching werkbon by ID:', err)
      return null
    }
  }, [organisatieId])

  const getWerkbonByIdWithMaterieel = useCallback(async (id) => {
    try {
      let q = supabase
        .from('werkbonnen')
        .select(
          `
          *,
          materialen,
          klant:klanten(*),
          medewerker:medewerkers!medewerker_id(*),
          werkbon_categorieen ( id, naam ),
          materieel:werkbon_materieel(*, artikel:artikelen(*))
        `
        )
        .eq('id', id)
      if (organisatieId) q = q.eq('organisatie_id', organisatieId)
      const { data, error: qError } = await q.single()

      if (qError) throw qError
      return data
    } catch (err) {
      console.error('Error fetching werkbon with materieel:', err)
      return null
    }
  }, [organisatieId])

  const addMaterieel = useCallback(async (werkbonId, items) => {
    if (!werkbonId || !Array.isArray(items) || items.length === 0) return { data: null, error: null }
    const valid = items.filter((m) => m.artikel_id && (m.aantal > 0 || m.aantal === undefined))
    if (valid.length === 0) return { data: null, error: null }
    try {
      const { data, error } = await supabase
        .from('werkbon_materieel')
        .insert(valid.map((m) => ({ werkbon_id: werkbonId, artikel_id: m.artikel_id, aantal: m.aantal ?? 1 })))
        .select()
      if (error) throw error
      if (mountedRef.current) fetchWerkbonnen({ silent: true }).catch(() => {})
      return { data, error: null }
    } catch (err) {
      console.error('Error adding materieel:', err)
      return { data: null, error: err }
    }
  }, [fetchWerkbonnen])

  const replaceWerkbonMaterieel = useCallback(async (werkbonId, items) => {
    try {
      await supabase.from('werkbon_materieel').delete().eq('werkbon_id', werkbonId)
      const valid = (items || []).filter((m) => m.artikel_id && (m.aantal > 0 || m.aantal === undefined))
      if (valid.length > 0) {
        const { error } = await supabase
          .from('werkbon_materieel')
          .insert(valid.map((m) => ({ werkbon_id: werkbonId, artikel_id: m.artikel_id, aantal: m.aantal ?? 1 })))
        if (error) throw error
      }
      if (mountedRef.current) fetchWerkbonnen({ silent: true }).catch(() => {})
      return { error: null }
    } catch (err) {
      console.error('Error replacing werkbon materieel:', err)
      return { error: err }
    }
  }, [fetchWerkbonnen])

  const getHasVervolgWerkbon = useCallback(async (werkbonId) => {
    if (!werkbonId) return false
    try {
      let q = supabase
        .from('werkbonnen')
        .select('id')
        .eq('gekopieerd_van_werkbon_id', werkbonId)
        .limit(1)
      if (organisatieId) q = q.eq('organisatie_id', organisatieId)
      const { data, error } = await q
      if (error) throw error
      return Array.isArray(data) && data.length > 0
    } catch (err) {
      console.error('Error checking vervolg werkbon:', err)
      return false
    }
  }, [organisatieId])

  /** Sanitize payload: lege strings → null voor UUID/date/enum, verwijder relation-objecten.
   * Voorkomt PostgreSQL 22P02 (invalid input syntax for type). */
  function sanitizeWerkbonPayload(data) {
    if (!data || typeof data !== 'object') return data
    const skipKeys = new Set([
      'materialen', 'klant', 'medewerker', 'werkbon_categorieen', 'materieel', 'created_at', 'id', 'werkbonnummer',
      'is_gereed', // Verwijderd: vervangen door klus_gereed; nooit meesturen (voorkomt 400 als kolom niet bestaat)
    ])
    const nullIfEmpty = new Set([
      'klant_id', 'categorie_id', 'medewerker_id', 'parent_id', 'gekopieerd_van_werkbon_id',
      'offerte_id', 'ingevuld_door', 'plandatum', 'einddatum', 'ingevuld_op',
      'onderweg_start', 'werkzaamheden_start', 'werkzaamheden_eind', 'archived_at',
      'werkuren_minuten', 'aanrijtijd_minuten', 'planblok', 'gewenst_tijdstip',
      'cash_verkoopordernummer_override',
    ])
    const out = {}
    for (const [k, v] of Object.entries(data)) {
      if (skipKeys.has(k)) continue
      if (typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date)) {
        continue // Geneste objecten (joins) niet meesturen
      }
      if ((v === '' || v === undefined) && nullIfEmpty.has(k)) {
        out[k] = null
      } else {
        out[k] = v
      }
    }
    return out
  }

  /** RPC: directe SQL-update van checkboxes. Garantie voor persistentie (omzeilt PostgREST). */
  const updateWerkbonCheckboxes = useCallback(async (id, klusGereed, vervolgNodig) => {
    try {
      const { data, error } = await supabase.rpc('update_werkbon_checkboxes', {
        p_werkbon_id: id,
        p_klus_gereed: !!klusGereed,
        p_vervolg_nodig: !!vervolgNodig,
        p_organisatie_id: organisatieId || null,
      })
      if (error) {
        console.error('useWerkbonnen: updateWerkbonCheckboxes RPC error:', error)
        return { data: null, error }
      }
      const row = Array.isArray(data) ? data[0] : data
      return { data: row, error: null }
    } catch (err) {
      console.error('useWerkbonnen: updateWerkbonCheckboxes exception:', err)
      return { data: null, error: err }
    }
  }, [organisatieId])

  /** RPC: atomisch status klaar + klus_gereed + vervolg_nodig + bevindingen/advies/interne_referentie. */
  const markWerkbonKlaar = useCallback(async (id, { klusGereed, vervolgNodig, bevindingen, advies, interne_referentie }) => {
    try {
      const { data, error } = await supabase.rpc('mark_werkbon_klaar', {
        p_werkbon_id: id,
        p_klus_gereed: !!klusGereed,
        p_vervolg_nodig: !!vervolgNodig,
        p_bevindingen: bevindingen ?? null,
        p_advies: advies ?? null,
        p_interne_referentie: interne_referentie ?? null,
      })
      if (error) {
        console.error('useWerkbonnen: markWerkbonKlaar RPC error:', error)
        return { data: null, error }
      }
      const row = Array.isArray(data) ? data[0] : data
      console.log('useWerkbonnen: markWerkbonKlaar success:', { id: row?.id, klus_gereed: row?.klus_gereed, vervolg_nodig: row?.vervolg_nodig })
      return { data: row, error: null }
    } catch (err) {
      console.error('useWerkbonnen: markWerkbonKlaar exception:', err)
      return { data: null, error: err }
    }
  }, [])

  const updateWerkbon = useCallback(async (id, werkbonData, medewerkerId = null, options = {}) => {
    const { skipRefresh = false } = options
    try {
      // Nooit materialen (JSONB) meesturen: die kolom wordt alleen door de buitendienst-app geschreven.
      // Zo voorkom je per ongeluk overschrijven met [] vanuit het ERP.
      const { materialen: _drop, ...rest } = werkbonData || {}
      const safeData = sanitizeWerkbonPayload(rest)
      console.log('useWerkbonnen: updateWerkbon called with:', {
        id,
        werkbonData: {
          ...safeData,
          status: safeData?.status,
          klus_gereed: safeData?.klus_gereed,
          vervolg_nodig: safeData?.vervolg_nodig,
        },
      })

      let updateQ = supabase
        .from('werkbonnen')
        .update(safeData)
        .eq('id', id)
      if (organisatieId) updateQ = updateQ.eq('organisatie_id', organisatieId)
      const { data, error } = await updateQ
        .select(`*, klant:klanten(*), medewerker:medewerkers!medewerker_id(*)`)
        .single()

      if (error) {
        console.error('useWerkbonnen: Error updating werkbon:', {
          message: error?.message,
          details: error?.details,
          hint: error?.hint,
          code: error?.code,
          full: error,
        })
        throw error
      }
      
      console.log('useWerkbonnen: Werkbon updated successfully:', {
        id: data?.id,
        werkbonnummer: data?.werkbonnummer,
        status: data?.status,
        klus_gereed: data?.klus_gereed,
        vervolg_nodig: data?.vervolg_nodig,
      })
      
      // De real-time subscription zou automatisch een refresh moeten triggeren
      // Maar we triggeren ook handmatig een refresh om er zeker van te zijn
      if (!skipRefresh && mountedRef.current) {
        console.log('useWerkbonnen: Triggering immediate refresh after update')
        fetchWerkbonnen({ silent: true }).catch((err) => {
          console.error('useWerkbonnen: Error during immediate refresh:', err)
        })
        setTimeout(() => {
          if (mountedRef.current) {
            fetchWerkbonnen({ silent: true }).catch((err) => {
              console.error('useWerkbonnen: Error during delayed refresh:', err)
            })
          }
        }, 1500)
      } else if (skipRefresh) {
        console.log('useWerkbonnen: Skipping refresh (skipRefresh=true)')
      } else {
        console.warn('useWerkbonnen: Component not mounted, skipping refresh')
      }
      
      return { data, error: null }
    } catch (err) {
      console.error('Error updating werkbon:', err)
      return { data: null, error: err }
    }
  }, [fetchWerkbonnen, organisatieId])

  useEffect(() => {
    let cancelled = false
    const timeoutRefs = [] // Track alle timeouts voor cleanup

    async function init() {
      if (cancelled) return
      console.log('useWerkbonnen: Initial fetch starting...')
      await fetchWerkbonnen()
      console.log('useWerkbonnen: Initial fetch completed')
    }

    // Start initial fetch
    init()

    if (!enableRealtime) {
      return () => { cancelled = true }
    }

    // Setup real-time subscription (kan in Safari privé "suspension" geven – dan geen live updates)
    const channel = supabase
      .channel('werkbonnen_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'werkbonnen' }, (payload) => {
        console.log('useWerkbonnen: Real-time change detected:', {
          eventType: payload.eventType,
          new: payload.new ? {
            id: payload.new.id,
            werkbonnummer: payload.new.werkbonnummer,
            status: payload.new.status,
            klus_gereed: payload.new.klus_gereed,
            vervolg_nodig: payload.new.vervolg_nodig,
          } : null,
          old: payload.old ? {
            id: payload.old.id,
            status: payload.old.status,
          } : null,
        })
        if (!cancelled && mountedRef.current) {
          const timeoutId = setTimeout(() => {
            if (!cancelled && mountedRef.current) {
              console.log('useWerkbonnen: Triggering refresh from real-time subscription after', payload.eventType)
              fetchWerkbonnen({ silent: true }).catch((err) => {
                console.error('useWerkbonnen: Error during real-time refresh:', err)
              })
            }
          }, 300)
          timeoutRefs.push(timeoutId)
        }
      })
      .subscribe((status) => {
        console.log('useWerkbonnen: Subscription status:', status)
        if (status === 'SUBSCRIBED') {
          console.log('useWerkbonnen: Successfully subscribed to real-time updates for werkbonnen table')
        } else if (status === 'CHANNEL_ERROR') {
          console.error('useWerkbonnen: Channel subscription error - real-time updates may not work')
        } else if (status === 'TIMED_OUT') {
          console.warn('useWerkbonnen: Subscription timed out - retrying...')
        }
      })

    return () => {
      cancelled = true
      console.log('useWerkbonnen: Cleaning up - cancelling timeouts and removing channel')
      timeoutRefs.forEach((timeoutId) => clearTimeout(timeoutId))
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisatieId])

  return {
    werkbonnen,
    loading,
    error,
    fetchWerkbonnen,
    getWerkbonById,
    getWerkbonByIdWithMaterieel,
    updateWerkbon,
    updateWerkbonCheckboxes,
    markWerkbonKlaar,
    addMaterieel,
    replaceWerkbonMaterieel,
    getHasVervolgWerkbon,
  }
}
