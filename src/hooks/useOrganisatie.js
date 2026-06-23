import { useCallback, useEffect, useState } from 'react'
import { supabase, getSupabaseUrl } from '../lib/supabaseClient'
import { useErpRole } from '../auth/useErpRole'
import { fetchTenantBranding } from '../lib/tenantBranding'

/**
 * Haalt logo-URL en bedrijfsgegevens op (NAW / instellingen + organisaties).
 */
export function useOrganisatie() {
  const { organisatieId } = useErpRole()
  const [data, setData] = useState({
    logoUrl: '',
    naam: '',
    adres: '',
    postcode: '',
    plaats: '',
    email: '',
    website: '',
    iban: '',
    btw: '',
    kvk: '',
  })
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    setLoading(true)
    try {
      const branding = await fetchTenantBranding(supabase, organisatieId, {
        supabaseUrl: getSupabaseUrl(),
      })
      setData(branding)
    } catch {
      setData((prev) => ({ ...prev, logoUrl: prev.logoUrl }))
    } finally {
      setLoading(false)
    }
  }, [organisatieId])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { ...data, loading, refetch }
}
