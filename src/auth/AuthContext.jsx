import React, { useEffect, useMemo, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { withTimeout } from '../lib/withTimeout'
import { AuthContext } from './AuthContextObject'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      if (!isSupabaseConfigured()) {
        console.error('Supabase niet geconfigureerd (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)')
        setSession(null)
        setLoading(false)
        return
      }
      try {
        const { data, error } = await withTimeout(supabase.auth.getSession(), 12000, 'Sessie ophalen')
        if (!error) {
          setSession(data?.session ?? null)
        } else {
          console.error('Auth session error:', error)
          setSession(null)
        }
      } catch (err) {
        console.error('AuthContext init error:', err)
        setSession(null)
      } finally {
        setLoading(false)
      }
    }

    init()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null)
    })

    return () => {
      sub?.subscription?.unsubscribe?.()
    }
  }, [])

  async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  async function logout() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  const value = useMemo(() => {
    const user = session?.user ?? null
    return { session, user, loading, login, logout }
  }, [session, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
