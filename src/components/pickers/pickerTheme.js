/** @typedef {'app' | 'werkbon' | 'buitendienst'} PickerVariant */

/** @returns {Record<string, string | number>} */
export function getPickerTheme(variant = 'app') {
  if (variant === 'werkbon') {
    return {
      text: '#fef2f2',
      textMuted: 'rgba(254, 202, 202, 0.85)',
      textFaint: 'rgba(254, 202, 202, 0.65)',
      textHint: 'rgba(254, 202, 202, 0.6)',
      count: 'rgba(254, 242, 242, 0.7)',
      inputBorder: '1px solid rgba(220, 38, 38, 0.3)',
      inputBg: 'rgba(45, 27, 27, 0.6)',
      listBorder: '1px solid rgba(220, 38, 38, 0.25)',
      listBg: 'rgba(30, 18, 18, 0.5)',
      listItemBorder: '1px solid rgba(220, 38, 38, 0.15)',
      rowBorder: '1px solid rgba(220, 38, 38, 0.2)',
      rowBg: 'rgba(30, 18, 18, 0.4)',
      addBorder: '1px solid rgba(34, 197, 94, 0.35)',
      addBg: 'rgba(34, 197, 94, 0.15)',
      removeBorder: '1px solid rgba(220, 38, 38, 0.3)',
      removeBg: 'rgba(220, 38, 38, 0.2)',
      inputRadius: 6,
      fontSize: 14,
      fontSizeSm: 13,
      fontSizeXs: 12,
    }
  }

  if (variant === 'buitendienst') {
    return {
      text: '#0f172a',
      textMuted: 'rgba(15, 23, 42, 0.85)',
      textFaint: 'rgba(15, 23, 42, 0.65)',
      textHint: 'rgba(15, 23, 42, 0.55)',
      count: 'rgba(15, 23, 42, 0.6)',
      inputBorder: '1px solid rgba(15, 23, 42, 0.15)',
      inputBg: '#ffffff',
      listBorder: '1px solid rgba(15, 23, 42, 0.12)',
      listBg: '#ffffff',
      listItemBorder: '1px solid rgba(15, 23, 42, 0.08)',
      rowBorder: '1px solid rgba(15, 23, 42, 0.12)',
      rowBg: '#f8fafc',
      addBorder: '1px solid rgba(34, 197, 94, 0.45)',
      addBg: 'rgba(34, 197, 94, 0.12)',
      removeBorder: '1px solid rgba(239, 68, 68, 0.35)',
      removeBg: 'rgba(239, 68, 68, 0.1)',
      inputRadius: 12,
      fontSize: 14,
      fontSizeSm: 13,
      fontSizeXs: 12,
    }
  }

  return {
    text: 'var(--app-text)',
    textMuted: 'var(--app-muted)',
    textFaint: 'var(--app-muted)',
    textHint: 'var(--app-muted2)',
    count: 'var(--app-muted)',
    inputBorder: '1px solid var(--app-border)',
    inputBg: 'rgba(15, 23, 42, 0.8)',
    listBorder: '1px solid var(--app-border)',
    listBg: 'rgba(15, 23, 42, 0.8)',
    listItemBorder: '1px solid var(--app-border)',
    rowBorder: '1px solid var(--app-border)',
    rowBg: 'rgba(15, 23, 42, 0.5)',
    addBorder: '1px solid rgba(59, 130, 246, 0.4)',
    addBg: 'rgba(59, 130, 246, 0.15)',
    addText: '#93c5fd',
    removeBorder: '1px solid rgba(239, 68, 68, 0.4)',
    removeBg: 'rgba(239, 68, 68, 0.12)',
    inputRadius: 6,
    fontSize: 14,
    fontSizeSm: 13,
    fontSizeXs: 12,
  }
}
