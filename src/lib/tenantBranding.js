/**
 * Eén bron voor tenant-branding: instellingen (NAW-scherm) met fallback organisaties-tabel.
 * Gebruik in app-hooks, Vercel API (serve-rapport-live) en offerte/rapport.
 */

export const DEFAULT_ORG_ID = 'a0000000-0000-0000-0000-000000000001'

export const ORGANISATIE_INSTELLINGEN_KEYS = [
  'organisatie_logo_url',
  'organisatie_naam',
  'organisatie_adres',
  'organisatie_postcode',
  'organisatie_plaats',
  'organisatie_email',
  'organisatie_website',
  'organisatie_iban',
  'organisatie_btw',
  'organisatie_kvk',
]

const LOGOS_BUCKET = 'logos'
const LEGACY_LOGO_PATH = 'logo.png'

function trim(v) {
  return String(v ?? '').trim()
}

/** Storage-pad logo per tenant (NAW-upload). */
export function getTenantLogoStoragePath(organisatieId) {
  const id = trim(organisatieId) || DEFAULT_ORG_ID
  return `${id}/${LEGACY_LOGO_PATH}`
}

export function getDefaultAppLogoUrl() {
  if (typeof window === 'undefined' || !window.location?.origin) return ''
  return `${window.location.origin}/logo/logo.png`
}

/** Publieke storage-URL voor logo (tenant-specifiek + legacy fallback). */
export function getStorageLogoPublicUrls(supabaseUrl, organisatieId) {
  const base = trim(supabaseUrl).replace(/\/$/, '')
  if (!base) return { tenant: '', legacy: '', bestanden: '' }
  const orgId = trim(organisatieId) || DEFAULT_ORG_ID
  return {
    tenant: `${base}/storage/v1/object/public/${LOGOS_BUCKET}/${orgId}/${LEGACY_LOGO_PATH}`,
    legacy: `${base}/storage/v1/object/public/${LOGOS_BUCKET}/${LEGACY_LOGO_PATH}`,
    bestanden: `${base}/storage/v1/object/public/bestanden/${LEGACY_LOGO_PATH}`,
  }
}

function instRowsToMap(rows) {
  const map = {}
  ;(rows || []).forEach((r) => {
    if (r?.key) map[r.key] = trim(r.value)
  })
  return map
}

/**
 * Merge instellingen (NAW) met organisaties-rij; instellingen winnen.
 * @param {Record<string, string>} inst
 * @param {object|null} org
 */
export function mergeTenantBranding(inst = {}, org = null) {
  const o = org || {}
  const logoFromInst = trim(inst.organisatie_logo_url)
  const logoFromOrg = trim(o.logo_url)
  return {
    logoUrl: logoFromInst || logoFromOrg || '',
    naam: trim(inst.organisatie_naam) || trim(o.naam) || '',
    adres: trim(inst.organisatie_adres) || trim(o.adres) || '',
    postcode: trim(inst.organisatie_postcode) || trim(o.postcode) || '',
    plaats: trim(inst.organisatie_plaats) || trim(o.plaats) || '',
    email: trim(inst.organisatie_email) || trim(o.email) || '',
    website: trim(inst.organisatie_website) || trim(o.website) || '',
    iban: trim(inst.organisatie_iban) || trim(o.iban) || '',
    btw: trim(inst.organisatie_btw) || trim(o.btw) || '',
    kvk: trim(inst.organisatie_kvk) || trim(o.kvk) || '',
  }
}

/**
 * Logo-URL met storage-fallbacks als instellingen/leeg zijn.
 */
export function resolveTenantLogoUrl(branding, organisatieId, supabaseUrl) {
  const direct = trim(branding?.logoUrl)
  if (direct && direct.startsWith('http')) return direct
  const urls = getStorageLogoPublicUrls(supabaseUrl, organisatieId)
  return urls.tenant || urls.legacy || urls.bestanden || getDefaultAppLogoUrl() || ''
}

/**
 * Payload voor sync naar organisaties na NAW-opslaan.
 */
export function brandingToOrganisatieUpdate(branding) {
  return {
    naam: branding.naam || null,
    logo_url: branding.logoUrl || null,
    adres: branding.adres || null,
    postcode: branding.postcode || null,
    plaats: branding.plaats || null,
    email: branding.email || null,
    website: branding.website || null,
    iban: branding.iban || null,
    btw: branding.btw || null,
    kvk: branding.kvk || null,
    updated_at: new Date().toISOString(),
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string|null} organisatieId
 * @param {{ supabaseUrl?: string, resolveLogoFallback?: boolean }} [opts]
 */
export async function fetchTenantBranding(supabase, organisatieId, opts = {}) {
  const orgId = trim(organisatieId) || DEFAULT_ORG_ID
  const empty = mergeTenantBranding({}, null)
  if (!supabase) return empty

  try {
    const [instRes, orgRes] = await Promise.all([
      supabase
        .from('instellingen')
        .select('key, value')
        .eq('organisatie_id', orgId)
        .in('key', ORGANISATIE_INSTELLINGEN_KEYS),
      supabase
        .from('organisaties')
        .select('naam, logo_url, adres, postcode, plaats, email, website, iban, btw, kvk')
        .eq('id', orgId)
        .maybeSingle(),
    ])
    if (instRes.error) throw instRes.error
    const merged = mergeTenantBranding(instRowsToMap(instRes.data), orgRes.data)
    if (opts.resolveLogoFallback !== false) {
      merged.logoUrl = resolveTenantLogoUrl(merged, orgId, opts.supabaseUrl)
    }
    return merged
  } catch {
    const merged = mergeTenantBranding({}, null)
    if (opts.resolveLogoFallback !== false) {
      merged.logoUrl = resolveTenantLogoUrl(merged, orgId, opts.supabaseUrl)
    }
    return merged
  }
}

/** Voor rapport-HTML: companyName + logoUrl. */
export function brandingForWerkbonReport(branding) {
  return {
    companyName: trim(branding?.naam) || undefined,
    logoUrl: trim(branding?.logoUrl) || '',
  }
}
