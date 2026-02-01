import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (!error) {
          setSession(data?.session ?? null)
        } else {
          setSession(null)
        }
      } catch {
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
    return {
      session,
      user,
      loading,
      login,
      logout,
    }
  }, [session, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
