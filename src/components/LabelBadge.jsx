import React from 'react'

function norm(v) {
  return String(v || '').toLowerCase().trim()
}

export default function LabelBadge({ label }) {
  const s = norm(label)
  const compact = s.replace(/[\s_-]+/g, '')
  if (!s) return null

  const baseStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0.28rem 0.65rem',
    fontSize: '12px',
    borderRadius: '999px',
    border: '1px solid transparent',
    fontWeight: 500,
    letterSpacing: '0.01em',
  }

  // GARANTIEBON = GEEL
  if (s.includes('garantie')) {
    return (
      <span
        style={{
          ...baseStyle,
          background: 'rgba(245, 158, 11, 0.18)',
          borderColor: 'rgba(245, 158, 11, 0.3)',
          color: '#fde68a',
        }}
      >
        {label}
      </span>
    )
  }

  // CONTRACTBON = ORANJE
  if (s.includes('contract')) {
    return (
      <span
        style={{
          ...baseStyle,
          background: '#f97316',
          borderColor: '#ea580c',
          color: '#fff7ed',
        }}
      >
        {label}
      </span>
    )
  }

  // WHATSAPP INTAKE = GROEN
  if (s.includes('whatsapp')) {
    return (
      <span
        style={{
          ...baseStyle,
          background: 'rgba(34, 197, 94, 0.18)',
          borderColor: 'rgba(34, 197, 94, 0.28)',
          color: '#86efac',
        }}
      >
        {label}
      </span>
    )
  }

  // OPNAMEBON = ROOD
  if (s.includes('opname')) {
    return (
      <span
        style={{
          ...baseStyle,
          background: 'rgba(239, 68, 68, 0.18)',
          borderColor: 'rgba(239, 68, 68, 0.28)',
          color: '#fca5a5',
        }}
      >
        {label}
      </span>
    )
  }

  // OFFERTEBON = BLAUW
  if (s.includes('offerte')) {
    return (
      <span
        style={{
          ...baseStyle,
          background: 'rgba(43, 137, 255, 0.18)',
          borderColor: 'rgba(96, 165, 250, 0.28)',
          color: '#bfdbfe',
        }}
      >
        {label}
      </span>
    )
  }

  // PRIJSAFSPRAAK = PAARS
  if (compact.includes('prijsafspraak')) {
    return (
      <span
        style={{
          ...baseStyle,
          background: 'rgba(168, 85, 247, 0.2)',
          borderColor: 'rgba(168, 85, 247, 0.34)',
          color: '#e9d5ff',
        }}
      >
        {label}
      </span>
    )
  }

  // ONDERAANNEMINGSBON = BRUIN
  if (compact.includes('onderaanneming')) {
    return (
      <span
        style={{
          ...baseStyle,
          background: 'rgba(120, 53, 15, 0.24)',
          borderColor: 'rgba(120, 53, 15, 0.4)',
          color: '#fcd9b6',
        }}
      >
        {label}
      </span>
    )
  }

  // BEVAT UITBESTEED WERK = GRIJS
  if (s.includes('uitbesteed')) {
    return (
      <span
        style={{
          ...baseStyle,
          background: 'rgba(148, 163, 184, 0.16)',
          borderColor: 'rgba(148, 163, 184, 0.22)',
          color: '#e2e8f0',
        }}
      >
        {label}
      </span>
    )
  }

  // DEFAULT = OKERGEEL
  return (
    <span
      style={{
        ...baseStyle,
        background: 'rgba(202, 138, 4, 0.22)',
        borderColor: 'rgba(202, 138, 4, 0.38)',
        color: '#fef3c7',
      }}
    >
      {label}
    </span>
  )
}
