/**
 * WerkbonnenZoekView
 * Read-only search over ALL werkbonnen for buitendienst/monteur.
 * Searching is allowed; editing, deleting or creating is NOT possible here.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useErpRole } from '../../auth/useErpRole'

const ALL_STATUSES = [
  { key: 'ALL',             label: 'Alle',          color: 'rgba(148,163,184,0.6)' },
  { key: 'nieuw',           label: 'Nieuw',          color: '#f59e0b' },
  { key: 'nog_in_te_plannen', label: 'Nog in te plannen', color: '#a78bfa' },
  { key: 'gepland',         label: 'Ingepland',      color: '#2563eb' },
  { key: 'onderweg',        label: 'Onderweg',       color: '#06b6d4' },
  { key: 'bezig',           label: 'Bezig',          color: '#f97316' },
  { key: 'gereed',          label: 'Gereed',         color: '#22c55e' },
  { key: 'wacht_op_akkoord', label: 'Wacht op akkoord', color: '#e879f9' },
  { key: 'afgehandeld',     label: 'Afgehandeld',    color: 'rgba(100,116,139,0.7)' },
  { key: 'gefactureerd',    label: 'Gefactureerd',   color: 'rgba(71,85,105,0.7)' },
]

const THEME = {
  bg: 'var(--app-bg, #0a1628)',
  panel: 'var(--app-panel, rgba(13,28,53,0.95))',
  border: 'var(--app-border, rgba(151,170,196,0.14))',
  text: 'var(--app-text, rgba(226,232,240,0.95))',
  muted: 'var(--app-muted, rgba(148,163,184,0.7))',
  brand: 'var(--app-accent, #2b89ff)',
}

function statusLabel(raw) {
  const s = String(raw || '').toLowerCase().trim()
  if (s === 'ingepland') return 'Ingepland'
  if (s === 'gepland') return 'Ingepland'
  if (s === 'nog_in_te_plannen' || s === 'nog in te plannen') return 'Nog in te plannen'
  if (s === 'wacht_op_akkoord' || s === 'wacht op akkoord') return 'Wacht op akkoord'
  const found = ALL_STATUSES.find(x => x.key === s)
  if (found) return found.label
  return raw || '—'
}

function statusColor(raw) {
  const s = String(raw || '').toLowerCase().trim()
  const norm = s === 'ingepland' ? 'gepland' : s === 'nog in te plannen' ? 'nog_in_te_plannen' : s === 'wacht op akkoord' ? 'wacht_op_akkoord' : s
  const found = ALL_STATUSES.find(x => x.key === norm)
  return found?.color ?? 'rgba(148,163,184,0.5)'
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function WerkbonnenZoekView() {
  const { rol, loading: roleLoading, organisatieId } = useErpRole()

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const debounceRef = useRef(null)

  const isMonteur = rol === 'buitendienst' || rol === 'monteur'

  const search = useCallback(async (q, sf) => {
    if (!organisatieId) return
    setLoading(true)
    setError('')
    try {
      const select = [
        'id', 'werkbonnummer', 'status', 'plandatum', 'created_at',
        'werk_straat', 'werk_huisnummer', 'werk_toevoeging', 'werk_postcode', 'werk_plaats',
        'werkomschrijving',
        'klant:klanten(id, naam)',
      ].join(', ')

      let qb = supabase
        .from('werkbonnen')
        .select(select)
        .eq('organisatie_id', organisatieId)
        .order('created_at', { ascending: false })
        .limit(60)

      const qTrim = String(q || '').trim()
      if (qTrim.length >= 2) {
        qb = qb.or([
          `werkbonnummer.ilike.%${qTrim}%`,
          `werk_straat.ilike.%${qTrim}%`,
          `werk_postcode.ilike.%${qTrim}%`,
          `werk_huisnummer.ilike.%${qTrim}%`,
          `werk_plaats.ilike.%${qTrim}%`,
        ].join(','))
      }

      if (sf && sf !== 'ALL') {
        if (sf === 'gepland') {
          qb = qb.in('status', ['gepland', 'ingepland'])
        } else if (sf === 'nog_in_te_plannen') {
          qb = qb.in('status', ['nog_in_te_plannen', 'nog in te plannen'])
        } else if (sf === 'wacht_op_akkoord') {
          qb = qb.in('status', ['wacht_op_akkoord', 'wacht op akkoord'])
        } else {
          qb = qb.eq('status', sf)
        }
      }

      const { data: direct, error: e1 } = await qb
      if (e1) throw e1

      let combined = direct ?? []

      // Extra: search by klantnaam when query is long enough
      if (qTrim.length >= 2) {
        const { data: klanten } = await supabase
          .from('klanten')
          .select('id')
          .eq('organisatie_id', organisatieId)
          .ilike('naam', `%${qTrim}%`)
          .limit(50)

        const klantIds = (klanten ?? []).map(k => k.id).filter(Boolean)
        if (klantIds.length > 0) {
          let qb2 = supabase
            .from('werkbonnen')
            .select(select)
            .eq('organisatie_id', organisatieId)
            .in('klant_id', klantIds)
            .order('created_at', { ascending: false })
            .limit(40)

          if (sf && sf !== 'ALL') {
            if (sf === 'gepland') qb2 = qb2.in('status', ['gepland', 'ingepland'])
            else if (sf === 'nog_in_te_plannen') qb2 = qb2.in('status', ['nog_in_te_plannen', 'nog in te plannen'])
            else if (sf === 'wacht_op_akkoord') qb2 = qb2.in('status', ['wacht_op_akkoord', 'wacht op akkoord'])
            else qb2 = qb2.eq('status', sf)
          }

          const { data: byKlant } = await qb2
          const existingIds = new Set(combined.map(x => x.id))
          for (const b of (byKlant ?? [])) {
            if (!existingIds.has(b.id)) combined.push(b)
          }
        }
      }

      setResults(combined)
    } catch (err) {
      setError(err?.message || 'Zoeken mislukt.')
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [organisatieId])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      search(query, statusFilter)
    }, 350)
    return () => clearTimeout(debounceRef.current)
  }, [query, statusFilter, search])

  if (roleLoading) {
    return <div style={{ padding: 24, color: THEME.muted }}>Laden…</div>
  }

  if (!isMonteur) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: THEME.muted }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 15, color: THEME.text }}>Geen toegang</div>
        <div style={{ marginTop: 6, fontSize: 13 }}>Werkbonnen zoeken is alleen beschikbaar voor monteurs.</div>
      </div>
    )
  }

  return (
    <div style={{ padding: 16, paddingBottom: 8 }}>
      {/* Zoekbalk */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <span style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          color: THEME.muted, pointerEvents: 'none', fontSize: 16,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Zoek op adres, klantnaam, postcode, werkbonnummer…"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '12px 12px 12px 38px',
            borderRadius: 12,
            border: `1px solid ${THEME.border}`,
            background: THEME.panel,
            color: THEME.text,
            fontSize: 15,
            outline: 'none',
          }}
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'transparent', border: 'none', color: THEME.muted,
              cursor: 'pointer', padding: 4, fontSize: 16,
            }}
          >✕</button>
        ) : null}
      </div>

      {/* Status-chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {ALL_STATUSES.map(s => {
          const active = statusFilter === s.key
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setStatusFilter(s.key)}
              style={{
                padding: '5px 10px',
                borderRadius: 20,
                border: `1px solid ${active ? s.color : THEME.border}`,
                background: active ? `${s.color}22` : 'transparent',
                color: active ? s.color : THEME.muted,
                fontSize: 12,
                cursor: 'pointer',
                transition: 'all 120ms ease',
                fontFamily: 'inherit',
              }}
            >
              {s.label}
            </button>
          )
        })}
      </div>

      {/* Status / loading */}
      {loading && <div style={{ color: THEME.muted, fontSize: 13, marginBottom: 10 }}>Zoeken…</div>}
      {error && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {!loading && !error && query.trim().length < 2 && statusFilter === 'ALL' && (
        <div style={{ color: THEME.muted, fontSize: 13, marginBottom: 10, textAlign: 'center', paddingTop: 32 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
          Typ minimaal 2 tekens of kies een status om te zoeken.
        </div>
      )}
      {!loading && !error && results.length === 0 && (query.trim().length >= 2 || statusFilter !== 'ALL') && (
        <div style={{ color: THEME.muted, fontSize: 13, textAlign: 'center', paddingTop: 32 }}>
          Geen werkbonnen gevonden.
        </div>
      )}

      {/* Resultaten */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {results.map(bon => {
          const expanded = expandedId === bon.id
          const adres = [bon.werk_straat, bon.werk_huisnummer, bon.werk_toevoeging].filter(Boolean).join(' ')
          const plaatsPc = [bon.werk_postcode, bon.werk_plaats].filter(Boolean).join(' ')
          return (
            <button
              key={bon.id}
              type="button"
              onClick={() => setExpandedId(expanded ? null : bon.id)}
              style={{
                width: '100%',
                textAlign: 'left',
                background: THEME.panel,
                border: `1px solid ${expanded ? THEME.brand : THEME.border}`,
                borderRadius: 12,
                padding: '12px 14px',
                cursor: 'pointer',
                transition: 'border-color 120ms ease',
              }}
            >
              {/* Bovenrij */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{
                  display: 'inline-block',
                  width: 8, height: 8, borderRadius: '50%',
                  background: statusColor(bon.status),
                  flexShrink: 0,
                }} />
                <span style={{ fontWeight: 500, fontSize: 14, color: THEME.text }}>
                  {bon.werkbonnummer || '—'}
                </span>
                <span style={{
                  marginLeft: 'auto', fontSize: 11,
                  color: statusColor(bon.status),
                  border: `1px solid ${statusColor(bon.status)}44`,
                  borderRadius: 8, padding: '2px 6px',
                  background: `${statusColor(bon.status)}11`,
                }}>
                  {statusLabel(bon.status)}
                </span>
              </div>

              {/* Klantnaam */}
              {bon.klant?.naam && (
                <div style={{ fontSize: 13, color: THEME.text, opacity: 0.85, marginBottom: 2 }}>
                  {bon.klant.naam}
                </div>
              )}

              {/* Adres */}
              {(adres || plaatsPc) && (
                <div style={{ fontSize: 12, color: THEME.muted }}>
                  {[adres, plaatsPc].filter(Boolean).join(', ')}
                </div>
              )}

              {/* Datum */}
              <div style={{ fontSize: 11, color: THEME.muted, marginTop: 4 }}>
                {bon.plandatum ? `Gepland: ${formatDate(bon.plandatum)}` : `Aangemeld: ${formatDate(bon.created_at)}`}
              </div>

              {/* Uitklapdetail (read-only) */}
              {expanded && (
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: `1px solid ${THEME.border}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    fontSize: 13,
                  }}
                  onClick={e => e.stopPropagation()}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <InfoBlock label="Werkbonnummer" value={bon.werkbonnummer} />
                    <InfoBlock label="Status" value={statusLabel(bon.status)} />
                    <InfoBlock label="Klantnaam" value={bon.klant?.naam} />
                    <InfoBlock label="Plan datum" value={formatDate(bon.plandatum)} />
                  </div>
                  {(adres || plaatsPc) && (
                    <InfoBlock label="Werkadres" value={[adres, plaatsPc].filter(Boolean).join(', ')} />
                  )}
                  {bon.werkomschrijving && (
                    <InfoBlock label="Omschrijving" value={bon.werkomschrijving} />
                  )}
                  <div style={{
                    marginTop: 4, padding: '6px 10px', borderRadius: 8,
                    background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)',
                    fontSize: 11, color: '#f87171',
                  }}>
                    Alleen-lezen weergave. Wijzigingen via de planningspagina.
                  </div>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function InfoBlock({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--app-text, rgba(226,232,240,0.95))' }}>{value || '—'}</div>
    </div>
  )
}
