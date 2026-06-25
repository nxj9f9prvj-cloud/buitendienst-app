import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { withTimeout } from '../lib/withTimeout'
import { useAuth } from './useAuth'

/** @typedef {'admin' | 'binnendienst' | 'buitendienst' | 'uitvoerder'} ErpRol */

const DEFAULT_ROL = 'buitendienst'

const ErpRoleContext = createContext(null)

export function ErpRoleProvider({ children }) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(!!user)
  const [rol, setRol] = useState(DEFAULT_ROL)
  const [medewerkerId, setMedewerkerId] = useState(null)
  const [medewerkerNaam, setMedewerkerNaam] = useState(null)
  const [medewerkerActief, setMedewerkerActief] = useState(true)
  const [organisatieId, setOrganisatieId] = useState(null)

  const fetchRole = useCallback(async () => {
    if (!user?.id) {
      setRol(DEFAULT_ROL)
      setMedewerkerId(null)
      setMedewerkerNaam(null)
      setMedewerkerActief(true)
      setOrganisatieId(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const { data, error } = await withTimeout(
        supabase.from('medewerkers').select('id, naam, rol, actief, organisatie_id').eq('user_id', user.id).maybeSingle(),
        8000,
        'Medewerker-rol ophalen'
      )
      if (error) throw error
      if (data?.rol) {
        setRol(data.rol)
        setMedewerkerId(data.id)
        setMedewerkerNaam(data.naam ?? null)
        setMedewerkerActief(data.actief !== false)
        setOrganisatieId(data.organisatie_id ?? null)
      } else {
        setRol(DEFAULT_ROL)
        setMedewerkerId(null)
        setMedewerkerNaam(null)
        setMedewerkerActief(true)
        setOrganisatieId(null)
      }
    } catch (err) {
      console.error('useErpRole:', err)
      setRol(DEFAULT_ROL)
      setMedewerkerId(null)
      setMedewerkerNaam(null)
      setMedewerkerActief(true)
      setOrganisatieId(null)
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    fetchRole()
  }, [fetchRole])

  const value = useMemo(() => {
    const isAdmin = rol === 'admin'
    const isBinnendienst = rol === 'binnendienst'
    const isBuitendienst = rol === 'buitendienst'
    const isUitvoerder = rol === 'uitvoerder'
    return {
      rol,
      medewerkerId,
      medewerkerNaam,
      medewerkerActief,
      organisatieId,
      loading,
      isAdmin,
      isBinnendienst,
      isBuitendienst,
      isUitvoerder,
      canAccessMedewerkersbeheer: isAdmin || isBinnendienst,
      canAccessBedrijfsgegevens: isAdmin,
      refetch: fetchRole,
    }
  }, [fetchRole, medewerkerActief, medewerkerId, medewerkerNaam, organisatieId, loading, rol])

  return <ErpRoleContext.Provider value={value}>{children}</ErpRoleContext.Provider>
}

export function useErpRole() {
  const ctx = useContext(ErpRoleContext)
  if (!ctx) {
    throw new Error('useErpRole must be used within ErpRoleProvider')
  }
  return ctx
}

/** @param {string | null | undefined} rol */
export function getDefaultAppPathForRol(rol) {
  const r = String(rol ?? '').toLowerCase()
  return (r === 'buitendienst' || r === 'uitvoerder') ? '/app/buitendienst' : '/app'
}
