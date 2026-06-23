import React from 'react'
import { formatArtikelOptionLabel } from '../../lib/formatArtikelOptionLabel'
import { useArtikelSearch } from '../../hooks/useArtikelSearch'
import { getPickerTheme } from './pickerTheme'
import SearchResultsList from './SearchResultsList'

/**
 * Zoek artikel → klik Toevoegen → optioneel zoek wissen.
 * @param {{ artikelen: Array, onAdd: (artikel: object) => void, readOnly?: boolean, variant?: 'app'|'werkbon'|'buitendienst', clearOnAdd?: boolean, maxResults?: number, title?: string|null, helpText?: string|null, placeholder?: string, showCount?: boolean, actionLabel?: string, compact?: boolean }} props
 */
export default function ArtikelSearchAdd({
  artikelen = [],
  onAdd,
  readOnly = false,
  variant = 'app',
  clearOnAdd = true,
  maxResults = 20,
  title = 'Artikel toevoegen',
  helpText = 'Zoek een artikel en klik op Toevoegen. Bestaande regels hieronder blijven staan en worden niet beïnvloed door de zoekopdracht.',
  placeholder = 'Zoek op omschrijving of artikelnummer...',
  showCount = true,
  actionLabel = 'Toevoegen',
  compact = false,
}) {
  const t = getPickerTheme(variant)
  const { search, setSearch, filteredArtikelen, visibleResults, hasSearch, clearSearch } = useArtikelSearch(artikelen, {
    maxResults,
  })

  function handleAdd(artikel) {
    if (!artikel?.id || readOnly) return
    onAdd(artikel)
    if (clearOnAdd) clearSearch()
  }

  return (
    <div style={{ marginBottom: compact ? 0 : 10 }}>
      {title ? (
        <div style={{ fontSize: t.fontSizeSm, color: t.textMuted, marginBottom: 6 }}>{title}</div>
      ) : null}
      {helpText ? (
        <p style={{ fontSize: t.fontSizeXs, color: t.textFaint, margin: compact ? '0 0 6px' : '0 0 8px' }}>{helpText}</p>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          disabled={readOnly}
          style={{
            width: '100%',
            maxWidth: compact ? '100%' : 320,
            flex: 1,
            minWidth: compact ? 0 : 160,
            padding: compact ? '6px 8px' : '8px 12px',
            borderRadius: t.inputRadius,
            border: t.inputBorder,
            background: t.inputBg,
            color: t.text,
            fontSize: compact ? t.fontSizeSm : t.fontSize,
          }}
        />
        {showCount && hasSearch ? (
          <span style={{ fontSize: t.fontSizeSm, color: t.count }}>
            {filteredArtikelen.length} van {artikelen?.length ?? 0} resultaten
          </span>
        ) : null}
      </div>
      {hasSearch && visibleResults.length > 0 && !readOnly ? (
        <div style={{ marginTop: 8 }}>
          <SearchResultsList
            variant={variant}
            items={visibleResults}
            renderLabel={(a) => formatArtikelOptionLabel(a)}
            renderAction={(a) => (
              <button
                type="button"
                onClick={() => handleAdd(a)}
                style={{
                  padding: '6px 12px',
                  borderRadius: t.inputRadius,
                  border: t.addBorder,
                  background: t.addBg,
                  color: t.addText ?? t.text,
                  fontSize: t.fontSizeXs,
                  cursor: 'pointer',
                }}
              >
                {actionLabel}
              </button>
            )}
          />
        </div>
      ) : null}
      {hasSearch && filteredArtikelen.length === 0 ? (
        <SearchResultsList variant={variant} items={[]} emptyMessage="Geen artikelen gevonden voor deze zoekopdracht." />
      ) : null}
    </div>
  )
}
