import { useCallback, useEffect, useState } from 'react'

const PREFS_KEY = 'buitendienst_app_prefs_v1'

const DEFAULTS = {
  theme: 'dark',                    // 'dark' | 'light'
  pushEnabled: false,
  showAfgehandeldInPlanning: false, // toon afgehandelde bons in planninglijst
  defaultView: 'vandaag',           // 'vandaag' | 'werkweek' | 'heleweek'
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // no-op
  }
}

export function useAppPrefs() {
  const [prefs, setPrefsState] = useState(loadPrefs)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', prefs.theme)
  }, [prefs.theme])

  const setPref = useCallback((key, value) => {
    setPrefsState(prev => {
      const next = { ...prev, [key]: value }
      savePrefs(next)
      return next
    })
  }, [])

  return { prefs, setPref }
}
