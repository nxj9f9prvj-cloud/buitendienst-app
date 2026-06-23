import React from 'react'
import { getPickerTheme } from './pickerTheme'

/**
 * Scrollbare zoekresultatenlijst met optionele actieknop per rij.
 * @param {{ variant?: string, items: Array, renderLabel: (item: any) => React.ReactNode, renderAction?: (item: any) => React.ReactNode, emptyMessage?: string, maxHeight?: number }} props
 */
export default function SearchResultsList({
  variant = 'app',
  items = [],
  renderLabel,
  renderAction,
  emptyMessage,
  maxHeight = 200,
}) {
  const t = getPickerTheme(variant)
  if (!items.length) {
    if (!emptyMessage) return null
    return (
      <div style={{ fontSize: t.fontSizeXs, color: t.textHint, marginBottom: 12 }}>
        {emptyMessage}
      </div>
    )
  }

  return (
    <ul
      style={{
        margin: '0 0 12px',
        padding: 0,
        listStyle: 'none',
        border: t.listBorder,
        borderRadius: t.inputRadius,
        maxHeight,
        overflowY: 'auto',
        background: t.listBg,
      }}
    >
      {items.map((item, index) => (
        <li
          key={item?.id ?? index}
          style={{
            borderBottom: t.listItemBorder,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            padding: '8px 12px',
          }}
        >
          <div style={{ minWidth: 0, fontSize: t.fontSizeSm, color: t.text }}>{renderLabel(item)}</div>
          {renderAction ? <div style={{ flexShrink: 0 }}>{renderAction(item)}</div> : null}
        </li>
      ))}
    </ul>
  )
}
