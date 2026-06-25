import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { useErpRole } from '../../auth/useErpRole'
import { getSupabaseAnonKey, getSupabaseUrl, supabase } from '../../lib/supabaseClient'
import { Capacitor } from '@capacitor/core'
import { NativeBiometric } from 'capacitor-native-biometric'

const BIOMETRIC_SERVER = 'nl.montiqu.buitendienst.portaal'

const STEPUP_STORAGE_KEY = 'medewerkersportaal_stepup_v1'
const CATEGORIE_LABELS = {
  certificaten: 'Certificaten',
  arbeidscontract: 'Arbeidscontract',
  salarisstroken: 'Salarisstroken',
  rie: 'RI&E',
  toolboxmeetings: 'Toolboxmeetings',
  overig: 'Overig',
}

const NL_MONTHS = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
]

function loonstrookSortKey(doc) {
  const titel = String(doc?.titel ?? '')
  const m = titel.match(/Loonstrook\s+(\w+)\s+(\d{4})/i)
  if (m) {
    const monthIdx = NL_MONTHS.indexOf(m[1].toLowerCase())
    const year = Number.parseInt(m[2], 10)
    if (monthIdx >= 0 && Number.isFinite(year)) return year * 12 + monthIdx
  }
  const d = new Date(doc?.created_at ?? 0)
  if (Number.isFinite(d.getTime())) return d.getFullYear() * 12 + d.getMonth()
  return 0
}

function loonstrookYear(doc) {
  const titel = String(doc?.titel ?? '')
  const m = titel.match(/Loonstrook\s+\w+\s+(\d{4})/i)
  if (m) return String(m[1])
  const d = new Date(doc?.created_at ?? 0)
  return Number.isFinite(d.getTime()) ? String(d.getFullYear()) : 'Onbekend'
}

function groupLoonstrokenByYear(docs) {
  const byYear = {}
  for (const doc of docs) {
    const year = loonstrookYear(doc)
    if (!byYear[year]) byYear[year] = []
    byYear[year].push(doc)
  }
  for (const year of Object.keys(byYear)) {
    byYear[year].sort((a, b) => loonstrookSortKey(b) - loonstrookSortKey(a))
  }
  return Object.keys(byYear)
    .sort((a, b) => Number(b) - Number(a))
    .map((year) => ({ year, items: byYear[year] }))
}

function DocumentCard({ doc, mailingDocumentId, onMail, showCategorie = true }) {
  const [showEmailInput, setShowEmailInput] = React.useState(false)
  const [emailValue, setEmailValue] = React.useState('')
  const busy = mailingDocumentId === doc.id

  function handleMailClick() {
    if (busy) return
    setShowEmailInput(true)
  }

  function handleSend() {
    const trimmed = emailValue.trim()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return
    onMail(doc.id, trimmed)
    setShowEmailInput(false)
    setEmailValue('')
  }

  return (
    <div
      style={{
        border: '1px solid var(--app-border)',
        borderRadius: 8,
        padding: 10,
        background: 'var(--app-bg)',
      }}
    >
      <div style={{ fontWeight: 500 }}>{doc.titel || doc.bestand_naam}</div>
      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
        {showCategorie ? `${CATEGORIE_LABELS[doc.categorie] || doc.categorie} • ` : ''}
        {new Date(doc.created_at).toLocaleDateString('nl-NL')}
      </div>

      {!showEmailInput ? (
        <button
          type="button"
          onClick={handleMailClick}
          disabled={busy}
          style={{
            marginTop: 8,
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid var(--app-accent)',
            background: 'var(--app-accent-softer)',
            color: 'var(--app-accent)',
            fontSize: 14,
            cursor: busy ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span>✉️</span>
          {busy ? 'Versturen…' : 'Mailen naar mij'}
        </button>
      ) : (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Naar welk e-mailadres?</div>
          <input
            type="email"
            value={emailValue}
            onChange={e => setEmailValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="jouw@email.nl"
            autoFocus
            style={{
              padding: '8px 10px', borderRadius: 8,
              border: '1px solid var(--app-border)',
              background: 'var(--app-bg)', color: 'var(--app-text)',
              fontSize: 16, width: '100%', boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={handleSend}
              disabled={!emailValue.trim()}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 8,
                border: 'none', background: 'var(--app-accent)',
                color: '#fff', fontSize: 14, cursor: 'pointer',
              }}
            >
              Versturen
            </button>
            <button
              type="button"
              onClick={() => { setShowEmailInput(false); setEmailValue('') }}
              style={{
                padding: '8px 12px', borderRadius: 8,
                border: '1px solid var(--app-border)',
                background: 'transparent', color: 'var(--app-muted)',
                fontSize: 14, cursor: 'pointer',
              }}
            >
              Annuleer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function safeSessionStorageGet(key) {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSessionStorageSet(key, value) {
  try {
    window.sessionStorage.setItem(key, value)
  } catch {
    // no-op
  }
}

function safeSessionStorageRemove(key) {
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    // no-op
  }
}

export default function MedewerkersPortaalView() {
  const { user } = useAuth()
  const { rol, loading: roleLoading, organisatieId } = useErpRole()

  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [smsError, setSmsError] = useState('')
  const [sendLoading, setSendLoading] = useState(false)
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [stepUpChecking, setStepUpChecking] = useState(true)
  const [stepUpToken, setStepUpToken] = useState(null)
  const [stepUpExpiresAt, setStepUpExpiresAt] = useState(null)
  const [documents, setDocuments] = useState([])
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [documentsError, setDocumentsError] = useState('')
  const [mailingDocumentId, setMailingDocumentId] = useState(null)
  const [mailSuccessMsg, setMailSuccessMsg] = useState('')
  const [registeredPhone, setRegisteredPhone] = useState('')
  const [expandedOlderLoonstrookYears, setExpandedOlderLoonstrookYears] = useState(() => new Set())

  // Biometric / Face ID state
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [biometricSaved, setBiometricSaved] = useState(false)
  const [biometricLoading, setBiometricLoading] = useState(false)
  const [biometricError, setBiometricError] = useState('')
  const [offerSaveBiometric, setOfferSaveBiometric] = useState(false)

  const isAllowedRole = rol === 'buitendienst' || rol === 'binnendienst' || rol === 'admin' || rol === 'monteur'
  const currentCalendarYear = new Date().getFullYear()

  const { overigeDocumenten, loonstrokenByYear } = useMemo(() => {
    const loonstroken = []
    const overige = []
    for (const doc of documents) {
      if (doc?.categorie === 'salarisstroken') loonstroken.push(doc)
      else overige.push(doc)
    }
    overige.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return {
      overigeDocumenten: overige,
      loonstrokenByYear: groupLoonstrokenByYear(loonstroken),
    }
  }, [documents])

  const toggleLoonstrookYear = useCallback((year) => {
    setExpandedOlderLoonstrookYears((prev) => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }, [])

  const isLoonstrookYearOpen = useCallback(
    (year) => {
      const y = Number.parseInt(year, 10)
      if (Number.isFinite(y) && y >= currentCalendarYear) return true
      return expandedOlderLoonstrookYears.has(year)
    },
    [currentCalendarYear, expandedOlderLoonstrookYears]
  )

  const clearStepUp = useCallback(() => {
    setStepUpToken(null)
    setStepUpExpiresAt(null)
    safeSessionStorageRemove(STEPUP_STORAGE_KEY)
    setOfferSaveBiometric(false)
  }, [])

  // Controleer of biometrie beschikbaar is op dit toestel
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    NativeBiometric.isAvailable()
      .then(result => {
        if (result.isAvailable) {
          setBiometricAvailable(true)
          // Kijk of er een opgeslagen sessie is
          NativeBiometric.getCredentials({ server: BIOMETRIC_SERVER })
            .then(creds => {
              if (creds?.password) {
                try {
                  const { expiresAt } = JSON.parse(creds.password)
                  if (new Date(expiresAt).getTime() > Date.now()) setBiometricSaved(true)
                } catch { /* no-op */ }
              }
            })
            .catch(() => { /* geen opgeslagen sessie */ })
        }
      })
      .catch(() => { /* biometrie niet beschikbaar */ })
  }, [])

  /** Verifieer met Face ID en herstel de opgeslagen step-up sessie */
  const loginWithBiometric = useCallback(async () => {
    setBiometricError('')
    setBiometricLoading(true)
    try {
      await NativeBiometric.verifyIdentity({
        reason: 'Bevestig je identiteit voor het medewerkersportaal',
        title: 'Montiqu Buitendienst',
        subtitle: 'Gebruik Face ID of Touch ID',
        description: 'Uw identiteit wordt bevestigd voor toegang tot uw documenten',
      })
      const creds = await NativeBiometric.getCredentials({ server: BIOMETRIC_SERVER })
      if (!creds?.password) throw new Error('Geen opgeslagen sessie gevonden.')
      const { token, expiresAt } = JSON.parse(creds.password)
      if (!token || new Date(expiresAt).getTime() <= Date.now()) {
        await NativeBiometric.deleteCredentials({ server: BIOMETRIC_SERVER })
        setBiometricSaved(false)
        throw new Error('Sessie is verlopen. Verifieer opnieuw via SMS.')
      }
      // Herstel step-up sessie
      setStepUpToken(token)
      setStepUpExpiresAt(expiresAt)
      safeSessionStorageSet(STEPUP_STORAGE_KEY, JSON.stringify({ token, expiresAt }))
    } catch (err) {
      if (String(err).includes('cancel') || String(err).includes('Cancel')) return
      setBiometricError(err?.message || 'Biometrische verificatie mislukt.')
    } finally {
      setBiometricLoading(false)
    }
  }, [])

  /** Sla step-up sessie beveiligd op in Keychain */
  const saveBiometricSession = useCallback(async (token, expiresAt) => {
    if (!user?.id || !biometricAvailable) return
    try {
      await NativeBiometric.setCredentials({
        username: user.id,
        password: JSON.stringify({ token, expiresAt }),
        server: BIOMETRIC_SERVER,
      })
      setBiometricSaved(true)
    } catch (err) {
      console.warn('[Biometric] Opslaan mislukt:', err)
    }
    setOfferSaveBiometric(false)
  }, [biometricAvailable, user?.id])

  const validateExistingStepUp = useCallback(
    async (token, expiresAt) => {
      if (!token || !expiresAt || !user?.id) return false
      if (new Date(expiresAt).getTime() <= Date.now()) return false

      let q = supabase
        .from('medewerker_portaal_stepup_sessions')
        .select('token, expires_at')
        .eq('token', token)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()
      if (organisatieId) {
        q = q.eq('organisatie_id', organisatieId)
      } else {
        q = q.is('organisatie_id', null)
      }

      const { data, error } = await q
      if (error || !data?.token) return false
      return true
    },
    [organisatieId, user?.id]
  )

  useEffect(() => {
    let cancelled = false
    async function initStepUp() {
      if (!user?.id) {
        if (!cancelled) setStepUpChecking(false)
        return
      }
      setStepUpChecking(true)
      const raw = safeSessionStorageGet(STEPUP_STORAGE_KEY)
      if (!raw) {
        if (!cancelled) setStepUpChecking(false)
        return
      }
      try {
        const parsed = JSON.parse(raw)
        const token = parsed?.token ? String(parsed.token) : ''
        const expiresAt = parsed?.expiresAt ? String(parsed.expiresAt) : ''
        const valid = await validateExistingStepUp(token, expiresAt)
        if (!cancelled && valid) {
          setStepUpToken(token)
          setStepUpExpiresAt(expiresAt)
        } else if (!cancelled) {
          clearStepUp()
        }
      } catch {
        if (!cancelled) clearStepUp()
      } finally {
        if (!cancelled) setStepUpChecking(false)
      }
    }
    initStepUp()
    return () => {
      cancelled = true
    }
  }, [clearStepUp, user?.id, validateExistingStepUp])

  useEffect(() => {
    let cancelled = false
    async function loadRegisteredPhone() {
      if (!user?.id) return
      try {
        let q = supabase
          .from('medewerkers')
          .select('id, telefoon, organisatie_id')
          .eq('user_id', user.id)
          .maybeSingle()
        if (organisatieId) q = q.eq('organisatie_id', organisatieId)
        else q = q.is('organisatie_id', null)
        const { data } = await q
        const tel = String(data?.telefoon ?? '').trim()
        if (!cancelled) {
          setRegisteredPhone(tel)
          if (tel) setPhone((prev) => prev || tel)
        }
      } catch {
        if (!cancelled) setRegisteredPhone('')
      }
    }
    loadRegisteredPhone()
    return () => {
      cancelled = true
    }
  }, [organisatieId, user?.id])

  const getAuthHeaders = useCallback(async () => {
    const { data, error } = await supabase.auth.getSession()
    if (error || !data?.session?.access_token) {
      throw new Error('Je sessie is verlopen. Log opnieuw in.')
    }
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: getSupabaseAnonKey(),
    }
  }, [])

  const sendCode = useCallback(async () => {
    if (!registeredPhone) {
      setSmsError('Er is nog geen telefoonnummer voor jouw account geregistreerd. Neem contact op met de beheerder.')
      return
    }
    const phoneTrim = String(phone || '').trim()
    if (!phoneTrim) {
      setSmsError('Vul je telefoonnummer in.')
      return
    }
    setSmsError('')
    setSendLoading(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${getSupabaseUrl().replace(/\/$/, '')}/functions/v1/send-medewerkersportaal-sms-code`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ phone: phoneTrim }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSmsError(data?.details || data?.error || data?.message || 'Code versturen mislukt.')
        return
      }
      setCodeSent(true)
      setSmsCode('')
    } catch (e) {
      setSmsError(e?.message || 'Code versturen mislukt.')
    } finally {
      setSendLoading(false)
    }
  }, [getAuthHeaders, phone, registeredPhone])

  const verifyCode = useCallback(async () => {
    if (!registeredPhone) {
      setSmsError('Er is nog geen telefoonnummer voor jouw account geregistreerd. Neem contact op met de beheerder.')
      return
    }
    const phoneTrim = String(phone || '').trim()
    const codeTrim = String(smsCode || '').replace(/\D/g, '').slice(0, 6)
    if (!phoneTrim) {
      setSmsError('Telefoonnummer ontbreekt.')
      return
    }
    if (codeTrim.length !== 6) {
      setSmsError('Voer de 6-cijferige code in.')
      return
    }
    setSmsError('')
    setVerifyLoading(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${getSupabaseUrl().replace(/\/$/, '')}/functions/v1/verify-medewerkersportaal-sms-code`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ phone: phoneTrim, code: codeTrim }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSmsError(data?.error || data?.message || 'Code ongeldig of verlopen.')
        return
      }
      const token = data?.token ? String(data.token) : ''
      const expiresAt = data?.expires_at ? String(data.expires_at) : ''
      if (!token || !expiresAt) {
        setSmsError('Step-up sessie kon niet worden aangemaakt.')
        return
      }
      setStepUpToken(token)
      setStepUpExpiresAt(expiresAt)
      safeSessionStorageSet(STEPUP_STORAGE_KEY, JSON.stringify({ token, expiresAt }))
      setSmsCode('')
      setCodeSent(false)
      // Bied Face ID opslaan aan als beschikbaar
      if (biometricAvailable && !biometricSaved) setOfferSaveBiometric(true)
    } catch (e) {
      setSmsError(e?.message || 'Controle mislukt.')
    } finally {
      setVerifyLoading(false)
    }
  }, [getAuthHeaders, phone, registeredPhone, smsCode])

  const timeLeftLabel = useMemo(() => {
    if (!stepUpExpiresAt) return ''
    const ms = Math.max(0, new Date(stepUpExpiresAt).getTime() - Date.now())
    const min = Math.floor(ms / 60000)
    return `${min} min`
  }, [stepUpExpiresAt])

  const loadDocuments = useCallback(async () => {
    if (!user?.id || !stepUpToken) return
    setDocumentsLoading(true)
    setDocumentsError('')
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${getSupabaseUrl().replace(/\/$/, '')}/functions/v1/list-medewerker-documents`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ stepup_token: stepUpToken }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !Array.isArray(data?.documents)) {
        throw new Error(data?.error || data?.message || 'Documenten laden mislukt.')
      }
      setDocuments(data.documents)
    } catch (e) {
      setDocuments([])
      setDocumentsError(e?.message || 'Documenten laden mislukt.')
    } finally {
      setDocumentsLoading(false)
    }
  }, [getAuthHeaders, stepUpToken, user?.id])

  const mailDocument = useCallback(
    async (documentId, emailTo) => {
      if (!stepUpToken) {
        setDocumentsError('Step-up verificatie vereist.')
        return
      }
      setMailingDocumentId(documentId)
      setDocumentsError('')
      setMailSuccessMsg('')
      try {
        const headers = await getAuthHeaders()
        const res = await fetch(`${getSupabaseUrl().replace(/\/$/, '')}/functions/v1/send-document-link`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ document_id: documentId, stepup_token: stepUpToken, email_to: emailTo }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.error || data?.message || 'Versturen mislukt.')
        }
        setMailSuccessMsg(`Link verstuurd naar ${emailTo}`)
        setTimeout(() => setMailSuccessMsg(''), 5000)
      } catch (e) {
        setDocumentsError(e?.message || 'E-mail versturen mislukt.')
      } finally {
        setMailingDocumentId(null)
      }
    },
    [getAuthHeaders, stepUpToken]
  )

  useEffect(() => {
    const isStepUpValid = !!stepUpToken && !!stepUpExpiresAt && new Date(stepUpExpiresAt).getTime() > Date.now()
    if (!isStepUpValid) return
    loadDocuments()
  }, [loadDocuments, stepUpToken, stepUpExpiresAt])

  if (roleLoading || stepUpChecking) {
    return <div style={{ padding: 24 }}>Bezig met laden…</div>
  }

  if (!isAllowedRole) {
    return (
      <div style={{ padding: 24, textAlign: 'center', opacity: 0.7 }}>
        Geen toegang tot het medewerkersportaal.
      </div>
    )
  }

  const isStepUpValid = !!stepUpToken && !!stepUpExpiresAt && new Date(stepUpExpiresAt).getTime() > Date.now()

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginTop: 0, marginBottom: 8 }}>Medewerkersportaal</h1>
      <p style={{ opacity: 0.8, marginTop: 0 }}>
        Toegang vereist SMS-identiteitsbevestiging (geldig 15 minuten).
      </p>

      <div
        style={{
          marginTop: 16,
          padding: 16,
          borderRadius: 10,
          border: '1px solid var(--app-border)',
          background: 'var(--app-panel)',
        }}
      >
        <div style={{ fontWeight: 500, marginBottom: 6 }}>Toegang</div>
        <div style={{ opacity: 0.85 }}>Ingelogde rol: {rol || '—'}</div>
        <div style={{ opacity: 0.85 }}>Step-up status: {isStepUpValid ? `geverifieerd (${timeLeftLabel} resterend)` : 'niet geverifieerd'}</div>
      </div>

      {/* Face ID knop (als beschikbaar en sessie opgeslagen) */}
      {!isStepUpValid ? (
        <>
      {biometricAvailable && biometricSaved && (
        <div style={{ marginTop: 16, maxWidth: 520 }}>
          <button
            type="button"
            onClick={loginWithBiometric}
            disabled={biometricLoading}
            style={{
              width: '100%',
              padding: '14px 16px',
              borderRadius: 12,
              border: '1px solid var(--app-accent)',
              background: 'var(--app-accent)',
              color: '#fff',
              fontSize: 15,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {biometricLoading ? 'Verificeren…' : '🔓 Toegang met Face ID / Touch ID'}
          </button>
          {biometricError && <div style={{ marginTop: 8, color: '#dc2626', fontSize: 13 }}>{biometricError}</div>}
          <button
            type="button"
            onClick={() => setBiometricSaved(false)}
            style={{
              marginTop: 8, width: '100%', padding: '10px', borderRadius: 10,
              border: '1px solid var(--app-border)', background: 'transparent',
              color: 'var(--app-muted)', fontSize: 13, cursor: 'pointer',
            }}
          >
            Liever via SMS verificatie
          </button>
        </div>
      )}

      <div
        style={{
          marginTop: 16,
          padding: 16,
          borderRadius: 10,
          border: '1px solid var(--app-border)',
          background: 'var(--app-panel)',
          maxWidth: 520,
          display: biometricAvailable && biometricSaved ? 'none' : 'block',
        }}
      >
        <div style={{ fontWeight: 500, marginBottom: 8 }}>SMS verificatie vereist</div>
          <div style={{ opacity: 0.75, marginBottom: 12 }}>
            Alleen het geregistreerde medewerker-telefoonnummer kan gebruikt worden voor SMS verificatie.
          </div>

          <label style={{ display: 'block', marginBottom: 6, opacity: 0.85 }}>Telefoonnummer</label>
          {registeredPhone ? (
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
              Geregistreerd nummer: {registeredPhone}
            </div>
          ) : null}
          <input
            type="tel"
            value={phone}
            onChange={(e) => {
              if (registeredPhone) return
              setPhone(e.target.value)
              setSmsError('')
              setCodeSent(false)
              setSmsCode('')
            }}
            placeholder="06-12345678"
            readOnly={!!registeredPhone}
            style={{
              width: '100%',
              maxWidth: 300,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--app-border)',
              background: 'var(--app-bg)',
              color: 'var(--app-text)',
            }}
          />

          {!codeSent ? (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                onClick={sendCode}
                disabled={sendLoading || !String(phone || '').trim() || !registeredPhone}
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid var(--app-accent)',
                  background: 'var(--app-accent)',
                  color: '#fff',
                }}
              >
                {sendLoading ? 'Code versturen…' : 'Verstuur code'}
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', marginBottom: 6, opacity: 0.85 }}>SMS-code (6 cijfers)</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={smsCode}
                onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                style={{
                  width: 140,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--app-border)',
                  background: 'var(--app-bg)',
                  color: 'var(--app-text)',
                }}
              />
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={verifyCode}
                  disabled={verifyLoading || String(smsCode).replace(/\D/g, '').length !== 6}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid var(--app-accent)',
                    background: 'var(--app-accent)',
                    color: '#fff',
                  }}
                >
                  {verifyLoading ? 'Controleren…' : 'Controleer code'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCodeSent(false)
                    setSmsCode('')
                    setSmsError('')
                  }}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid var(--app-border)',
                    background: 'var(--app-bg)',
                    color: 'var(--app-text)',
                  }}
                >
                  Nieuwe code
                </button>
              </div>
            </div>
          )}

          {smsError ? <div style={{ marginTop: 10, color: '#dc2626' }}>{smsError}</div> : null}
        </div>
        </>
      ) : (
        <>
          {/* Face ID opslaan aanbieding (direct na SMS verificatie) */}
          {offerSaveBiometric && biometricAvailable && (
            <div style={{
              marginTop: 16, padding: 14, borderRadius: 12,
              border: '1px solid var(--app-accent)',
              background: 'var(--app-accent-softer, rgba(43,137,255,0.08))',
              maxWidth: 520,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div style={{ fontWeight: 500, fontSize: 14 }}>🔐 Snel toegang met Face ID</div>
              <div style={{ fontSize: 13, opacity: 0.8 }}>
                Sla je sessie beveiligd op in de Keychain. De volgende keer log je in met Face ID of Touch ID.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => saveBiometricSession(stepUpToken, stepUpExpiresAt)}
                  style={{
                    padding: '10px 16px', borderRadius: 10,
                    border: '1px solid var(--app-accent)',
                    background: 'var(--app-accent)', color: '#fff',
                    fontSize: 13, cursor: 'pointer', fontWeight: 500,
                  }}
                >
                  Ja, sla op
                </button>
                <button
                  type="button"
                  onClick={() => setOfferSaveBiometric(false)}
                  style={{
                    padding: '10px 16px', borderRadius: 10,
                    border: '1px solid var(--app-border)',
                    background: 'transparent', color: 'var(--app-muted)',
                    fontSize: 13, cursor: 'pointer',
                  }}
                >
                  Niet nu
                </button>
              </div>
            </div>
          )}

          <div
            style={{
              marginTop: 16,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 12,
              alignItems: 'start',
            }}
          >
            <div style={{ padding: 16, borderRadius: 10, border: '1px solid var(--app-border)', background: 'var(--app-panel)' }}>
              <div style={{ fontWeight: 500, marginBottom: 6 }}>Mijn documenten</div>
              <p style={{ fontSize: 13, opacity: 0.75, marginTop: 0, marginBottom: 12 }}>
                Certificaten, contract en overige documenten. Loonstroken staan apart.
              </p>
              {mailSuccessMsg ? (
                <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', fontSize: 13 }}>
                  ✓ {mailSuccessMsg}
                </div>
              ) : null}
              {documentsError ? (
                <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', fontSize: 13 }}>
                  {documentsError}
                </div>
              ) : null}
              {documentsLoading ? (
                <div style={{ opacity: 0.75 }}>Laden…</div>
              ) : overigeDocumenten.length === 0 ? (
                <div style={{ opacity: 0.75 }}>Nog geen overige documenten beschikbaar.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {overigeDocumenten.map((d) => (
                    <DocumentCard
                      key={d.id}
                      doc={d}
                      mailingDocumentId={mailingDocumentId}
                      onMail={mailDocument}
                    />
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: 16, borderRadius: 10, border: '1px solid var(--app-border)', background: 'var(--app-panel)' }}>
              <div style={{ fontWeight: 500, marginBottom: 6 }}>Loonstroken</div>
              <p style={{ fontSize: 13, opacity: 0.75, marginTop: 0, marginBottom: 12 }}>
                Maandelijkse salarisstroken, gegroepeerd per jaar.
              </p>
              {documentsLoading ? (
                <div style={{ opacity: 0.75 }}>Laden…</div>
              ) : loonstrokenByYear.length === 0 ? (
                <div style={{ opacity: 0.75 }}>Nog geen loonstroken beschikbaar.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {loonstrokenByYear.map(({ year, items }) => {
                    const yearNum = Number.parseInt(year, 10)
                    const isOlderYear = Number.isFinite(yearNum) && yearNum < currentCalendarYear
                    const open = isLoonstrookYearOpen(year)
                    return (
                      <div key={year}>
                        {isOlderYear ? (
                          <button
                            type="button"
                            onClick={() => toggleLoonstrookYear(year)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              width: '100%',
                              padding: '8px 10px',
                              marginBottom: open ? 8 : 0,
                              borderRadius: 8,
                              border: '1px solid var(--app-border)',
                              background: 'var(--app-bg)',
                              color: 'var(--app-text)',
                              fontSize: 14,
                              fontWeight: 500,
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            <span>{year}</span>
                            <span style={{ fontSize: 12, opacity: 0.75 }}>
                              {open ? '▼' : '▶'} {items.length} strook{items.length === 1 ? '' : 'en'}
                            </span>
                          </button>
                        ) : (
                          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, opacity: 0.9 }}>{year}</div>
                        )}
                        {open ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {items.map((d) => (
                              <DocumentCard
                                key={d.id}
                                doc={d}
                                mailingDocumentId={mailingDocumentId}
                                onMail={mailDocument}
                                showCategorie={false}
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          {documentsError ? <div style={{ marginTop: 10, color: '#dc2626' }}>{documentsError}</div> : null}

          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={clearStepUp}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid var(--app-border)',
                background: 'var(--app-bg)',
                color: 'var(--app-text)',
              }}
            >
              Opnieuw verifiëren
            </button>
          </div>
        </>
      )}
    </div>
  )
}
