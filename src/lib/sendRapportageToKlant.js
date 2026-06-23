/**
 * Stuurt de rapportage-URL per e-mail naar de klant (mailadres werkbon).
 * Gebruikt bestaande rapport_url op de werkbon, of genereert en uploadt de rapportage eerst.
 * Aanroepbaar vanaf OutlookPlanningBoard, WerkbonVijverPage en DashboardPage.
 */

import { generateWerkbonReportHtml } from './generateWerkbonReportHtml'
import { getSupabaseUrl, getSupabaseAnonKey } from './supabaseClient'
import { magRapportageNaarOpdrachtgever } from './werkbonVerplichteVelden'
import { brandingForWerkbonReport, fetchTenantBranding } from './tenantBranding'

export function formatRapportageVerzondenLogOpmerking(email) {
  const normalized = String(email ?? '').trim().toLowerCase()
  const iso = new Date().toISOString()
  return `Rapportage verzonden naar: ${normalized} | verzonden_op: ${iso}`
}

function safeJsonParseArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  const s = String(value).trim()
  if (!s) return []
  try {
    const parsed = JSON.parse(s)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function getWerkadresFromWerkbon(wb) {
  const useVestiging = !!wb?.werkadres_gelijk_aan_vestiging
  const k = wb?.klant
  if (useVestiging && k) {
    const straat = String(k.straat ?? '').trim()
    const huisnr = String(k.huisnummer ?? '').trim()
    const toev = String(k.toevoeging ?? '').trim()
    const pc = String(k.postcode ?? '').trim()
    const plaats = String(k.plaats ?? '').trim()
    return [straat, [huisnr, toev].filter(Boolean).join(''), pc, plaats].filter(Boolean).join(' ').trim()
  }
  const parts = [
    String(wb?.werk_straat ?? '').trim(),
    String(wb?.werk_huisnummer ?? '').trim(),
    String(wb?.werk_toevoeging ?? '').trim(),
    String(wb?.werk_postcode ?? '').trim(),
    String(wb?.werk_plaats ?? '').trim(),
  ].filter(Boolean)
  return parts.join(' ').trim() || ''
}

/**
 * @param {string} werkbonId
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ fallbackTo?: string, logoUrl?: string, companyName?: string }} [options] - fallbackTo: bij geen klant-mailadres; logoUrl + companyName: voor rapport-HTML (bijv. uit useOrganisatie)
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function sendRapportageToKlant(werkbonId, supabase, options = {}) {
  if (!werkbonId || !supabase) {
    return { success: false, error: 'Ontbrekende gegevens' }
  }

  try {
    const { data: wb, error: fetchError } = await supabase
      .from('werkbonnen')
      .select(
        `
        *,
        materialen,
        klant:klanten(*),
        materieel:werkbon_materieel(*, artikel:artikelen(*))
      `
      )
      .eq('id', werkbonId)
      .single()

    if (fetchError || !wb) {
      return { success: false, error: fetchError?.message || 'Werkbon niet gevonden' }
    }

    if (!magRapportageNaarOpdrachtgever(wb)) {
      return {
        success: false,
        error: 'Contractbon zonder "vervolgwerk noodzakelijk" mag niet naar opdrachtgever worden gemaild.',
      }
    }

    let toEmail = (wb?.klant?.email_werkbon ?? wb?.klant?.email)?.trim?.() || ''
    if (!toEmail && options.fallbackTo) {
      toEmail = String(options.fallbackTo).trim()
    }
    if (!toEmail) {
      return { success: false, error: 'Geen mailadres (werkbon) bij de klant' }
    }

    // Altijd verse HTML genereren zodat handtekening en andere updates altijd meegaan
    const werkadres = getWerkadresFromWerkbon(wb)
    const materieelList = Array.isArray(wb?.materieel) ? wb.materieel : []
    const materialenJsonb = safeJsonParseArray(wb?.materialen) || []
    const materialenForReport =
      materieelList.length > 0
        ? materieelList.map((m) => `${m?.artikel?.omschrijving || 'Artikel'} – ${m.aantal ?? 1} st`)
        : materialenJsonb.map((m) =>
            typeof m === 'string' ? m : `${m?.naam ?? m?.omschrijving ?? '—'} – ${m?.qty ?? m?.aantal ?? 1} st`
          )
    const branding = await fetchTenantBranding(supabase, wb?.organisatie_id, {
      supabaseUrl: getSupabaseUrl(),
    })
    const reportBranding = brandingForWerkbonReport(branding)
    const logoUrl = (options.logoUrl && options.logoUrl.trim()) || reportBranding.logoUrl
    const companyName = (options.companyName && options.companyName.trim()) || reportBranding.companyName
    const html = generateWerkbonReportHtml({
      werkbonnummer: wb?.werkbonnummer || '',
      klantnaam: wb?.klant?.naam || '',
      werkadres,
      referentie1: wb?.klantreferentie || '',
      referentie2: wb?.interne_referentie || '',
      uitvoerdatum: wb?.plandatum || wb?.updated_at || '',
      probleemstelling: wb?.werkomschrijving || '',
      bevindingen: wb?.bevindingen || '',
      advies: wb?.advies || wb?.advies_reparatie || wb?.vervolgadvies || '',
      fotos: wb?.fotos || wb?.foto_urls || safeJsonParseArray(wb?.fotos_urls) || [],
      materialen: materialenForReport,
      logoUrl,
      handtekeningUrl: wb?.handtekening_url || '',
      companyName,
    })

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const safeWb = String(wb?.werkbonnummer || wb?.id || 'werkbon').replaceAll('/', '-')
    const filePath = `rapportages/${safeWb}-${Date.now()}.html`
    const uploadRes = await supabase.storage.from('rapportages').upload(filePath, blob, {
      contentType: 'text/html',
      upsert: true,
    })
    if (uploadRes?.error) {
      return { success: false, error: 'Rapportage uploaden mislukt: ' + (uploadRes.error.message || 'onbekend') }
    }
    const pub = supabase.storage.from('rapportages').getPublicUrl(filePath)
    const rapportUrl = pub?.data?.publicUrl || ''
    if (!rapportUrl) {
      return { success: false, error: 'Rapportage-URL kon niet worden opgehaald' }
    }
    await supabase.from('werkbonnen').update({ rapport_url: rapportUrl }).eq('id', werkbonId)

    // Direct fetch met expliciete URL + anon key (voorkomt 403 door verkeerde URL/cache in client)
    const fnBody = {
      to: toEmail,
      klantnaam: wb?.klant?.naam || '',
      rapport_url: rapportUrl,
      werkbonnummer: wb?.werkbonnummer || '',
      werkbon_id: werkbonId,
    }
    const fnUrl = `${getSupabaseUrl().replace(/\/$/, '')}/functions/v1/send-rapportage-email`
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token || getSupabaseAnonKey()
    const fnRes = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: getSupabaseAnonKey(),
      },
      body: JSON.stringify(fnBody),
    })
    const fnData = await fnRes.json().catch(() => ({}))
    if (!fnRes.ok) {
      const msg = fnData?.error || fnRes.statusText || `HTTP ${fnRes.status}`
      const details = fnData?.details
      const detailsStr =
        details && typeof details === 'object' && details.message
          ? details.message
          : details && typeof details === 'object'
            ? JSON.stringify(details)
            : typeof details === 'string'
              ? details
              : ''
      return {
        success: false,
        error: detailsStr ? `${msg} (${detailsStr})` : msg,
      }
    }
    if (fnData?.error) {
      return { success: false, error: fnData.error || 'E-mail verzenden mislukt' }
    }

    try {
      const createdBy = session?.user?.id ?? null
      const createdByNaam = session?.user?.email ?? null
      const logMessage = formatRapportageVerzondenLogOpmerking(toEmail)
      await supabase.from('werkbon_log').insert({
        werkbon_id: werkbonId,
        type: 'opmerking',
        opmerking: logMessage,
        created_by: createdBy,
        created_by_naam: createdByNaam,
      })
    } catch {
      // Niet blokkeren: e-mail is al verzonden
    }

    return { success: true }
  } catch (e) {
    return { success: false, error: e?.message || String(e) }
  }
}
