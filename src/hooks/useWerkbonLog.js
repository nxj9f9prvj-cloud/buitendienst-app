import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

/** Voor "aangemaakt door" / "door X" in het logboek. Export voor o.a. OutlookPlanningBoard. */
export async function getCurrentUserId() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.user?.id ?? null
}

/** Weergavenaam voor logboek: medewerker.naam of anders e-mail. */
async function getCurrentUserDisplayName() {
  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData?.session?.user?.id ?? null
  const email = sessionData?.session?.user?.email ?? null
  if (!userId) return null
  const { data: medewerker } = await supabase
    .from('medewerkers')
    .select('naam')
    .eq('user_id', userId)
    .maybeSingle()
  if (medewerker?.naam && String(medewerker.naam).trim()) return String(medewerker.naam).trim()
  if (email && String(email).trim()) return String(email).trim()
  return null
}

function normalizeStatus(value) {
  return String(value ?? '').trim().toLowerCase()
}

function isPrijsafspraakLabel(value) {
  return normalizeStatus(value) === 'prijsafspraak'
}

function getAmsterdamDateTimeParts(date = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(date)
  const map = Object.create(null)
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

function amsterdamLocalToUtcIso({ year, month, day, hour, minute = 0, second = 0 }) {
  // Iteratieve correctie voor timezone/DST zodat lokale Amsterdam-tijd exact wordt geraakt.
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, second)
  const desiredUtcLike = Date.UTC(year, month - 1, day, hour, minute, second)
  for (let i = 0; i < 3; i += 1) {
    const got = getAmsterdamDateTimeParts(new Date(utcMs))
    const gotUtcLike = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second)
    utcMs += (desiredUtcLike - gotUtcLike)
  }
  return new Date(utcMs).toISOString()
}

async function getPrijsafspraakKlaarLogCreatedAt(werkbonId, statusVoor, statusNa) {
  if (!werkbonId) return null
  if (normalizeStatus(statusVoor) !== 'gepland' || normalizeStatus(statusNa) !== 'klaar') return null
  try {
    const { data: wb, error } = await supabase
      .from('werkbonnen')
      .select('label')
      .eq('id', werkbonId)
      .maybeSingle()
    if (error || !isPrijsafspraakLabel(wb?.label)) return null
    const nowParts = getAmsterdamDateTimeParts(new Date())
    const targetHour = nowParts.hour < 12 ? 12 : 17
    return amsterdamLocalToUtcIso({
      year: nowParts.year,
      month: nowParts.month,
      day: nowParts.day,
      hour: targetHour,
      minute: 0,
      second: 0,
    })
  } catch {
    return null
  }
}

/**
 * Standalone: log een statuswijziging voor een werkbon (voor gebruik buiten useWerkbonLog, bijv. OutlookPlanningBoard, DashboardPage).
 * @param {string} werkbonId
 * @param {string|null} statusVoor
 * @param {string|null} statusNa
 * @param {string|null} [toelichting]
 * @returns {{ error: Error|null }}
 */
export async function logStatusWijziging(werkbonId, statusVoor, statusNa, toelichting = null) {
  if (!werkbonId) return { error: new Error('Geen werkbon') }
  try {
    const [createdBy, createdByNaam] = await Promise.all([getCurrentUserId(), getCurrentUserDisplayName()])
    const createdAtOverride = await getPrijsafspraakKlaarLogCreatedAt(werkbonId, statusVoor, statusNa)
    const row = {
      werkbon_id: werkbonId,
      type: 'status_wijziging',
      status_voor: statusVoor ?? null,
      status_na: statusNa ?? null,
      created_by: createdBy ?? null,
      created_by_naam: createdByNaam ?? null,
      ...(createdAtOverride ? { created_at: createdAtOverride } : {}),
    }
    if (toelichting && String(toelichting).trim()) row.opmerking = String(toelichting).trim()
    const { error: insError } = await supabase.from('werkbon_log').insert(row)
    if (insError) throw insError
    return { error: null }
  } catch (err) {
    return { error: err }
  }
}

/**
 * Na kopieer-werkbon: verwijder foutief label "bevat uitbesteed werk" van de bron
 * als er geen echte uitbestedingsbonnen zijn (parent_id children met label onderaannemingsbon).
 * Kopie-bonnen gebruiken gekopieerd_van_werkbon_id, niet parent_id. Als copy_werkbon ten onrechte
 * parent_id heeft gezet, kan de trigger het label op de bron hebben gezet – dit herstelt dat.
 * @param {string} sourceWerkbonId - id van de werkbon waaruit gekopieerd is
 */
export async function fixBevatUitbesteedLabelAfterCopy(sourceWerkbonId) {
  if (!sourceWerkbonId) return
  try {
    const { data: uitbesteedChildren } = await supabase
      .from('werkbonnen')
      .select('id')
      .eq('parent_id', sourceWerkbonId)
      .eq('label', 'onderaannemingsbon')
    const heeftUitbesteed = (uitbesteedChildren ?? []).length > 0
    if (!heeftUitbesteed) {
      await supabase
        .from('werkbonnen')
        .update({ label: null })
        .eq('id', sourceWerkbonId)
        .eq('label', 'bevat uitbesteed werk')
    }
  } catch {
    // Stille fout – niet blokkeren
  }
}

/**
 * Standalone: log dat een werkbon is aangemaakt (voor weergave "Aangemaakt door X op datum om tijd").
 * @param {string} werkbonId
 * @returns {{ error: Error|null }}
 */
export async function logAangemaakt(werkbonId) {
  if (!werkbonId) return { error: new Error('Geen werkbon') }
  try {
    const [createdBy, createdByNaam] = await Promise.all([getCurrentUserId(), getCurrentUserDisplayName()])
    const { error: insError } = await supabase.from('werkbon_log').insert({
      werkbon_id: werkbonId,
      type: 'aangemaakt',
      created_by: createdBy ?? null,
      created_by_naam: createdByNaam ?? null,
    })
    if (insError) throw insError
    return { error: null }
  } catch (err) {
    return { error: err }
  }
}

/**
 * Standalone: log een opmerking op een werkbon (voor acties zoals "Gefactureerd", "Offerte gemaakt").
 * @param {string} werkbonId
 * @param {string} opmerking
 * @returns {{ error: Error|null }}
 */
export async function logOpmerkingForWerkbon(werkbonId, opmerking) {
  if (!werkbonId || !opmerking || !String(opmerking).trim()) return { error: new Error('Geen werkbon of opmerking') }
  try {
    const [createdBy, createdByNaam] = await Promise.all([getCurrentUserId(), getCurrentUserDisplayName()])
    const { error: insError } = await supabase.from('werkbon_log').insert({
      werkbon_id: werkbonId,
      type: 'opmerking',
      opmerking: String(opmerking).trim(),
      created_by: createdBy ?? null,
      created_by_naam: createdByNaam ?? null,
    })
    if (insError) throw insError
    return { error: null }
  } catch (err) {
    return { error: err }
  }
}

/**
 * Standalone: log een tijdsregistratie-stap (Onderweg naar klant, Begin werkzaamheden, Einde werkzaamheden).
 * @param {string} werkbonId
 * @param {string} stap - bijv. 'Onderweg naar klant', 'Begin werkzaamheden', 'Einde werkzaamheden'
 * @returns {{ error: Error|null }}
 */
export async function logTijdRegistratie(werkbonId, stap) {
  if (!werkbonId || !stap || !String(stap).trim()) return { error: new Error('Geen werkbon of stap') }
  try {
    const [createdBy, createdByNaam] = await Promise.all([getCurrentUserId(), getCurrentUserDisplayName()])
    const { error: insError } = await supabase.from('werkbon_log').insert({
      werkbon_id: werkbonId,
      type: 'tijd_registratie',
      opmerking: String(stap).trim(),
      created_by: createdBy ?? null,
      created_by_naam: createdByNaam ?? null,
    })
    if (insError) throw insError
    return { error: null }
  } catch (err) {
    return { error: err }
  }
}

/**
 * Logboek per werkbon: ophalen, opmerking toevoegen, statuswijziging loggen, Realtime.
 */
export function useWerkbonLog(werkbonId) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchEntries = useCallback(async () => {
    if (!werkbonId) {
      if (mountedRef.current) {
        setEntries([])
        setLoading(false)
      }
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { data, error: qError } = await supabase
        .from('werkbon_log')
        .select('*')
        .eq('werkbon_id', werkbonId)
        .order('created_at', { ascending: true })
      if (qError) throw qError
      if (mountedRef.current) setEntries(data || [])
    } catch (err) {
      if (mountedRef.current) {
        setError(err)
        setEntries([])
      }
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [werkbonId])

  useEffect(() => {
    fetchEntries()
    if (!werkbonId) return
    const channel = supabase
      .channel(`werkbon_log_${werkbonId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'werkbon_log',
        filter: `werkbon_id=eq.${werkbonId}`,
      }, () => {
        fetchEntries()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [werkbonId, fetchEntries])

  const addOpmerking = useCallback(async (opmerking) => {
    if (!werkbonId || !opmerking || !String(opmerking).trim()) return { error: new Error('Geen werkbon of opmerking') }
    try {
      const [createdBy, createdByNaam] = await Promise.all([getCurrentUserId(), getCurrentUserDisplayName()])
      const { error: insError } = await supabase.from('werkbon_log').insert({
        werkbon_id: werkbonId,
        type: 'opmerking',
        opmerking: String(opmerking).trim(),
        created_by: createdBy ?? null,
        created_by_naam: createdByNaam ?? null,
      })
      if (insError) throw insError
      await fetchEntries()
      return { error: null }
    } catch (err) {
      return { error: err }
    }
  }, [werkbonId, fetchEntries])

  const addStatusWijziging = useCallback(async (statusVoor, statusNa, toelichting = null) => {
    if (!werkbonId) return { error: new Error('Geen werkbon') }
    try {
      const [createdBy, createdByNaam] = await Promise.all([getCurrentUserId(), getCurrentUserDisplayName()])
      const createdAtOverride = await getPrijsafspraakKlaarLogCreatedAt(werkbonId, statusVoor, statusNa)
      const row = {
        werkbon_id: werkbonId,
        type: 'status_wijziging',
        status_voor: statusVoor ?? null,
        status_na: statusNa ?? null,
        created_by: createdBy ?? null,
        created_by_naam: createdByNaam ?? null,
        ...(createdAtOverride ? { created_at: createdAtOverride } : {}),
      }
      if (toelichting && String(toelichting).trim()) row.opmerking = String(toelichting).trim()
      const { error: insError } = await supabase.from('werkbon_log').insert(row)
      if (insError) throw insError
      await fetchEntries()
      return { error: null }
    } catch (err) {
      return { error: err }
    }
  }, [werkbonId, fetchEntries])

  return {
    entries,
    loading,
    error,
    fetchEntries,
    addOpmerking,
    addStatusWijziging,
  }
}

const PREVIEW_LIMIT = 3
const BATCH_LIMIT = 2000

/**
 * Haalt voor meerdere werkbonnen de laatste N logregels op (voor preview op kaartjes).
 * previews[werkbonId] = array van max N entries (nieuwste eerst).
 */
export function useWerkbonLogPreviews(werkbonIds, n = PREVIEW_LIMIT) {
  const [previews, setPreviews] = useState({})
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    const ids = Array.isArray(werkbonIds) ? werkbonIds.filter(Boolean) : []
    if (ids.length === 0) {
      if (mountedRef.current) {
        setPreviews({})
        setLoading(false)
      }
      return
    }
    setLoading(true)
    supabase
      .from('werkbon_log')
      .select('*')
      .in('werkbon_id', ids)
      .order('created_at', { ascending: false })
      .limit(BATCH_LIMIT)
      .then(({ data, error }) => {
        if (!mountedRef.current) return
        setLoading(false)
        if (error) {
          setPreviews({})
          return
        }
        const byId = {}
        ;(data || []).forEach((row) => {
          const wid = row.werkbon_id
          if (!byId[wid]) byId[wid] = []
          if (byId[wid].length < n) byId[wid].push(row)
        })
        setPreviews(byId)
      })
      .catch(() => {
        if (mountedRef.current) {
          setLoading(false)
          setPreviews({})
        }
      })
  }, [werkbonIds?.join(','), n])

  return { previews, loading }
}
