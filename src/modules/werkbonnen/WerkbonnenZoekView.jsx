/**
 * WerkbonnenZoekView
 * Read-only search over ALL werkbonnen for buitendienst/monteur.
 * Searching is allowed; editing, deleting or creating is NOT possible here.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useErpRole } from '../../auth/useErpRole'
import { mapWerkbonMaterialen, WERKBON_MATERIEEL_SELECT } from '../../lib/werkbonMaterialenDisplay'

const STATUS_COLOR = {
  nieuw:              '#f59e0b',
  nog_in_te_plannen:  '#a78bfa',
  'nog in te plannen':'#a78bfa',
  gepland:            '#2563eb',
  ingepland:          '#2563eb',
  onderweg:           '#06b6d4',
  bezig:              '#f97316',
  gereed:             '#22c55e',
  wacht_op_akkoord:   '#e879f9',
  'wacht op akkoord': '#e879f9',
  afgehandeld:        'rgba(100,116,139,0.7)',
  gefactureerd:       'rgba(71,85,105,0.7)',
}

const STATUS_LABEL = {
  nieuw:              'Nieuw',
  nog_in_te_plannen:  'Nog in te plannen',
  'nog in te plannen':'Nog in te plannen',
  gepland:            'Ingepland',
  ingepland:          'Ingepland',
  onderweg:           'Onderweg',
  bezig:              'Bezig',
  gereed:             'Gereed',
  wacht_op_akkoord:   'Wacht op akkoord',
  'wacht op akkoord': 'Wacht op akkoord',
  afgehandeld:        'Afgehandeld',
  gefactureerd:       'Gefactureerd',
}

function statusLabel(raw) {
  const s = String(raw || '').toLowerCase().trim()
  return STATUS_LABEL[s] ?? (raw || '—')
}

function statusColor(raw) {
  const s = String(raw || '').toLowerCase().trim()
  return STATUS_COLOR[s] ?? 'rgba(148,163,184,0.5)'
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function firstText(...values) {
  for (const v of values) {
    const s = String(v ?? '').trim()
    if (s) return s
  }
  return ''
}

function formatAdres({ straat, huisnummer, toevoeging, postcode, plaats } = {}) {
  const straatRegel = [straat, huisnummer, toevoeging].filter(Boolean).join(' ')
  const plaatsRegel = [postcode, plaats].filter(Boolean).join(' ')
  return [straatRegel, plaatsRegel].filter(Boolean).join(', ')
}

function getKlantTelefoon(klant) {
  return firstText(
    klant?.telefoon,
    klant?.telefoonnummer,
    klant?.telefoon_werkbon,
    klant?.mobiel,
    klant?.tel,
  )
}

function getKlantEmail(klant) {
  return firstText(klant?.email_werkbon, klant?.email)
}

function getWerkadres(bon) {
  const fromBon = formatAdres({
    straat: bon?.werk_straat,
    huisnummer: bon?.werk_huisnummer,
    toevoeging: bon?.werk_toevoeging,
    postcode: bon?.werk_postcode,
    plaats: bon?.werk_plaats,
  })
  if (fromBon) return fromBon
  if (bon?.werkadres_gelijk_aan_vestiging && bon?.klant) {
    return formatAdres({
      straat: bon.klant.straat,
      huisnummer: bon.klant.huisnummer,
      toevoeging: bon.klant.toevoeging,
      postcode: bon.klant.postcode,
      plaats: bon.klant.plaats,
    })
  }
  return ''
}

function getKlantadres(klant) {
  if (!klant) return ''
  return formatAdres({
    straat: klant.straat,
    huisnummer: klant.huisnummer,
    toevoeging: klant.toevoeging,
    postcode: klant.postcode,
    plaats: klant.plaats,
  })
}

const DETAIL_SELECT = [
  'id', 'werkbonnummer', 'status', 'plandatum', 'created_at',
  'werk_straat', 'werk_huisnummer', 'werk_toevoeging', 'werk_postcode', 'werk_plaats',
  'werkadres_gelijk_aan_vestiging',
  'werkomschrijving', 'bevindingen', 'advies',
  'interne_referentie', 'interne_referentie_buitendienst', 'klantreferentie',
  'fotos_urls', 'materialen',
  'klus_gereed', 'vervolg_nodig',
  'klant:klanten(*)',
  WERKBON_MATERIEEL_SELECT,
].join(', ')

const DETAIL_SELECT_FALLBACK = [
  'id', 'werkbonnummer', 'status', 'plandatum', 'created_at',
  'werk_straat', 'werk_huisnummer', 'werk_toevoeging', 'werk_postcode', 'werk_plaats',
  'werkomschrijving', 'bevindingen', 'advies',
  'interne_referentie', 'interne_referentie_buitendienst', 'klantreferentie',
  'fotos_urls', 'materialen',
  'klus_gereed', 'vervolg_nodig',
  'klant:klanten(*)',
].join(', ')

export default function WerkbonnenZoekView({ logoUrl, naam }) {
  const { rol, loading: roleLoading, organisatieId } = useErpRole()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [detailsById, setDetailsById] = useState({})
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const debounceRef = useRef(null)

  const isMonteur = rol === 'buitendienst' || rol === 'uitvoerder' || rol === 'monteur' || rol === 'admin'

  const search = useCallback(async (q) => {
    if (!organisatieId) return
    setLoading(true)
    setError('')
    try {
      const select = [
        'id', 'werkbonnummer', 'status', 'plandatum', 'created_at',
        'werk_straat', 'werk_huisnummer', 'werk_toevoeging', 'werk_postcode', 'werk_plaats',
        'werkomschrijving', 'fotos_urls',
        'klant:klanten(id, naam)',
      ].join(', ')

      const qTrim = String(q || '').trim()

      let qb = supabase
        .from('werkbonnen')
        .select(select)
        .eq('organisatie_id', organisatieId)
        .order('created_at', { ascending: false })
        .limit(60)

      if (qTrim.length >= 2) {
        qb = qb.or([
          `werkbonnummer.ilike.%${qTrim}%`,
          `werk_straat.ilike.%${qTrim}%`,
          `werk_postcode.ilike.%${qTrim}%`,
          `werk_huisnummer.ilike.%${qTrim}%`,
          `werk_plaats.ilike.%${qTrim}%`,
        ].join(','))
      }

      const { data: direct, error: e1 } = await qb
      if (e1) throw e1

      let combined = direct ?? []

      // Also search by klantnaam
      if (qTrim.length >= 2) {
        const { data: klanten } = await supabase
          .from('klanten')
          .select('id')
          .eq('organisatie_id', organisatieId)
          .ilike('naam', `%${qTrim}%`)
          .limit(50)

        const klantIds = (klanten ?? []).map(k => k.id).filter(Boolean)
        if (klantIds.length > 0) {
          const { data: byKlant } = await supabase
            .from('werkbonnen')
            .select(select)
            .eq('organisatie_id', organisatieId)
            .in('klant_id', klantIds)
            .order('created_at', { ascending: false })
            .limit(40)

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
    debounceRef.current = setTimeout(() => search(query), 350)
    return () => clearTimeout(debounceRef.current)
  }, [query, search])

  useEffect(() => {
    if (!expandedId || !organisatieId) return
    if (detailsById[expandedId]) return

    let cancelled = false
    setDetailLoading(true)
    setDetailError('')

    const load = async () => {
      const run = (selectClause) =>
        supabase
          .from('werkbonnen')
          .select(selectClause)
          .eq('id', expandedId)
          .eq('organisatie_id', organisatieId)
          .single()

      let { data, error: qError } = await run(DETAIL_SELECT)
      if (qError) {
        const retry = await run(DETAIL_SELECT_FALLBACK)
        data = retry.data
        qError = retry.error
      }

      if (cancelled) return
      setDetailLoading(false)
      if (qError) {
        setDetailError(qError.message || 'Details laden mislukt.')
        return
      }
      setDetailsById((prev) => ({ ...prev, [expandedId]: data }))
    }

    load().catch((err) => {
      if (cancelled) return
      setDetailLoading(false)
      setDetailError(err?.message || 'Details laden mislukt.')
    })

    return () => { cancelled = true }
  }, [expandedId, organisatieId, detailsById])

  if (roleLoading) return (
    <div style={{ padding: 24, color: 'var(--app-muted)' }}>Laden…</div>
  )

  if (!isMonteur) return (
    <div style={{ padding: 24, textAlign: 'center', color: 'var(--app-muted)' }}>
      <div style={{ fontSize: 13, color: 'var(--app-text)' }}>Geen toegang</div>
      <div style={{ marginTop: 4, fontSize: 12 }}>Alleen beschikbaar voor monteurs.</div>
    </div>
  )

  const hasQuery = query.trim().length >= 2
  const showEmpty = !loading && !error && results.length === 0 && hasQuery
  const showPrompt = !loading && !error && !hasQuery

  return (
    <div style={{ padding: '12px 16px 8px' }}>

      {/* ── Compacte header ──────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderRadius: 14,
        background: 'var(--app-panel)',
        border: '1px solid var(--app-border)',
        boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
        marginBottom: 18,
      }}>
        {logoUrl && (
          <img
            src={logoUrl}
            alt={naam || 'Logo'}
            style={{ height: 36, width: 'auto', maxWidth: 120, objectFit: 'contain', objectPosition: 'left center', flexShrink: 0 }}
            onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
          />
        )}
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--app-accent)' }}>
          Werkbonnen
        </div>
      </div>

      {/* ── Zoekbalk ─────────────────────────────────────────────────────── */}
      <div style={{ position: 'relative', marginBottom: 20 }}>
        <span style={{
          position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--app-muted)', pointerEvents: 'none',
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Adres, klantnaam, postcode of bonnummer…"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '13px 38px 13px 38px',
            borderRadius: 13,
            border: '1px solid var(--app-border)',
            background: 'var(--app-panel)',
            color: 'var(--app-text)',
            fontSize: 15,
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            style={{
              position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)',
              background: 'rgba(148,163,184,0.15)', border: 'none',
              borderRadius: '50%', width: 22, height: 22,
              color: 'var(--app-muted)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, lineHeight: 1,
            }}
          >✕</button>
        ) : null}
      </div>

      {/* ── Feedback ─────────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ color: 'var(--app-muted)', fontSize: 13, textAlign: 'center', paddingTop: 32 }}>
          Zoeken…
        </div>
      )}
      {error && (
        <div style={{ color: '#f87171', fontSize: 13, marginBottom: 10 }}>{error}</div>
      )}
      {showPrompt && (
        <div style={{ color: 'var(--app-muted)', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
          <svg style={{ display: 'block', margin: '0 auto 12px', opacity: 0.4 }} width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          Typ minimaal 2 tekens om te zoeken.
        </div>
      )}
      {showEmpty && (
        <div style={{ color: 'var(--app-muted)', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
          Geen werkbonnen gevonden.
        </div>
      )}

      {/* ── Resultaten ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {results.map(bon => {
          const expanded = expandedId === bon.id
          const adres = [bon.werk_straat, bon.werk_huisnummer, bon.werk_toevoeging].filter(Boolean).join(' ')
          const plaatsPc = [bon.werk_postcode, bon.werk_plaats].filter(Boolean).join(' ')
          const sc = statusColor(bon.status)
          return (
            <button
              key={bon.id}
              type="button"
              onClick={() => setExpandedId(expanded ? null : bon.id)}
              style={{
                width: '100%',
                textAlign: 'left',
                background: 'var(--app-panel)',
                border: `1px solid ${expanded ? 'var(--app-accent)' : 'var(--app-border)'}`,
                borderRadius: 13,
                padding: '12px 14px',
                cursor: 'pointer',
                transition: 'border-color 120ms ease',
                fontFamily: 'inherit',
              }}
            >
              {/* Bovenrij: nummer + status badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: sc, flexShrink: 0, display: 'inline-block' }} />
                <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--app-text)', flex: 1 }}>
                  {bon.werkbonnummer || '—'}
                </span>
                <span style={{
                  fontSize: 11,
                  color: sc,
                  border: `1px solid ${sc}44`,
                  borderRadius: 8,
                  padding: '2px 7px',
                  background: `${sc}11`,
                  flexShrink: 0,
                }}>
                  {statusLabel(bon.status)}
                </span>
              </div>

              {/* Klantnaam */}
              {bon.klant?.naam && (
                <div style={{ fontSize: 13, color: 'var(--app-text)', marginBottom: 1 }}>
                  {bon.klant.naam}
                </div>
              )}

              {/* Adres */}
              {(adres || plaatsPc) && (
                <div style={{ fontSize: 12, color: 'var(--app-muted)' }}>
                  {[adres, plaatsPc].filter(Boolean).join(', ')}
                </div>
              )}

              {/* Datum */}
              <div style={{ fontSize: 11, color: 'var(--app-muted)', marginTop: 4 }}>
                {bon.plandatum
                  ? `Gepland: ${formatDate(bon.plandatum)}`
                  : `Aangemeld: ${formatDate(bon.created_at)}`}
              </div>

              {expanded && (
                <div onClick={e => e.stopPropagation()}>
                  {detailLoading && !detailsById[bon.id] ? (
                    <div style={{
                      marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--app-border)',
                      fontSize: 13, color: 'var(--app-muted)',
                    }}>
                      Details laden…
                    </div>
                  ) : (
                    <WerkbonDetail
                      bon={detailsById[bon.id] || bon}
                      detailError={detailError}
                      onOpenFoto={setLightboxUrl}
                    />
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Lightbox — volledig scherm foto bekijken */}
      {lightboxUrl ? (
        <div
          onClick={() => setLightboxUrl(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column',
            padding: 'env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)',
          }}
        >
          <img
            src={lightboxUrl}
            alt="foto"
            style={{
              maxWidth: '100%', maxHeight: '85vh',
              objectFit: 'contain', borderRadius: 12,
              boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
            }}
          />
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            style={{
              marginTop: 20, padding: '10px 28px', borderRadius: 12,
              background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)',
              color: '#fff', fontSize: 15, cursor: 'pointer',
            }}
          >
            Sluiten
          </button>
        </div>
      ) : null}
    </div>
  )
}

function WerkbonDetail({ bon, detailError, onOpenFoto }) {
  const klant = bon?.klant || {}
  const telefoon = getKlantTelefoon(klant)
  const email = getKlantEmail(klant)
  const klantadres = getKlantadres(klant)
  const werkadres = getWerkadres(bon)
  const { lines: materiaalRegels } = mapWerkbonMaterialen(bon)
  const fotos = Array.isArray(bon?.fotos_urls) ? bon.fotos_urls.filter(Boolean) : []
  const listAdres = [bon.werk_straat, bon.werk_huisnummer, bon.werk_toevoeging].filter(Boolean).join(' ')
  const listPlaatsPc = [bon.werk_postcode, bon.werk_plaats].filter(Boolean).join(' ')

  return (
    <div
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: '1px solid var(--app-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {detailError ? (
        <div style={{ fontSize: 12, color: '#f87171' }}>{detailError}</div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <InfoBlock label="Werkbonnummer" value={bon.werkbonnummer} />
        <InfoBlock label="Status" value={statusLabel(bon.status)} />
        <InfoBlock label="Klantnaam" value={klant.naam} />
        <InfoBlock label="Plandatum" value={formatDate(bon.plandatum)} />
      </div>

      <InfoBlock label="Klantadres" value={klantadres} />
      <InfoBlock label="Telefoonnummer">
        {telefoon ? <ContactLink type="tel" value={telefoon} /> : '—'}
      </InfoBlock>
      <InfoBlock label="E-mailadres">
        {email ? <ContactLink type="mailto" value={email} /> : '—'}
      </InfoBlock>
      <InfoBlock
        label="Werkadres"
        value={werkadres || [listAdres, listPlaatsPc].filter(Boolean).join(', ')}
      />
      <InfoBlock label="Interne referentie" value={bon.interne_referentie} />
      <InfoBlock label="Aanvulling interne referentie" value={bon.interne_referentie_buitendienst} />
      <InfoBlock label="Werkomschrijving" value={bon.werkomschrijving} />
      <InfoBlock label="Advies" value={bon.advies} />

      <div>
        <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 6 }}>Materialen gebruikt</div>
        {materiaalRegels.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--app-text)' }}>— geen materialen —</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {materiaalRegels.map((m, i) => (
              <div
                key={`${m.artikelnummer || m.naam}-${i}`}
                style={{ fontSize: 13, color: 'var(--app-text)' }}
              >
                {m.naam || '—'}
                {(m.aantal || m.eenheid || m.artikelnummer) ? (
                  <span style={{ fontSize: 12, color: 'var(--app-muted)' }}>
                    {' · '}
                    {[
                      m.aantal ? `Aantal: ${m.aantal}` : null,
                      m.eenheid || null,
                      m.artikelnummer ? `Nr: ${m.artikelnummer}` : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {fotos.length > 0 && (
        <div>
          <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 6 }}>
            Foto's ({fotos.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {fotos.map((url, i) => (
              <button
                key={i}
                type="button"
                onClick={e => { e.stopPropagation(); onOpenFoto(url) }}
                style={{
                  padding: 0, border: '1px solid var(--app-border)',
                  borderRadius: 8, overflow: 'hidden',
                  background: 'var(--app-panel)', cursor: 'pointer',
                  aspectRatio: '1 / 1',
                }}
              >
                <img
                  src={url}
                  alt={`foto ${i + 1}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{
        marginTop: 2, padding: '6px 10px', borderRadius: 8,
        background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)',
        fontSize: 11, color: '#f87171',
      }}>
        Alleen-lezen · aanpassen via de planningstool in het ERP
      </div>
    </div>
  )
}

function ContactLink({ type, value }) {
  const v = String(value || '').trim()
  if (!v) return '—'
  const href = type === 'tel' ? `tel:${v.replace(/[^\d+]/g, '')}` : `mailto:${v}`
  return (
    <a
      href={href}
      style={{ color: 'var(--app-accent)', textDecoration: 'underline' }}
    >
      {v}
    </a>
  )
}

function InfoBlock({ label, value, children }) {
  const content = children ?? (value || '—')
  return (
    <div>
      <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--app-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {content || '—'}
      </div>
    </div>
  )
}
