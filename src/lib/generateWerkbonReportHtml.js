/**
 * Genereert HTML voor de werkbonrapportage (zoals bestaand systeem rapport.rioolservicealphen.nl).
 * Layout: titel "Rapport van [adres]", "in [plaats]", datum/tijd, veldenblok, Probleemstelling, Bevindingen, Advies, Afbeeldingen & Video's, Materialen, footer.
 */

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function nl2br(s) {
  const x = String(s ?? '').trim()
  if (!x) return ''
  return esc(x).replaceAll('\n', '<br />')
}

/** Nederlandse lange datum (zonder tijd), bijv. "vrijdag 30 januari 2026" */
function formatRapportDatum(dateLike) {
  if (!dateLike) return ''
  const d = new Date(dateLike)
  if (isNaN(d)) return ''
  return d.toLocaleDateString('nl-NL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * @param {Object} opts
 * @param {string} [opts.werkbonnummer]
 * @param {string} [opts.klantnaam] - Opdrachtgever
 * @param {string} [opts.werkadres] - Volledig werkadres; gebruikt voor titel (Rapport van X / in Y) en veld Werkadres
 * @param {string} [opts.referentie1] - Klantreferentie
 * @param {string} [opts.referentie2] - Interne referentie
 * @param {string|Date} [opts.uitvoerdatum] - Datum/tijd uitvoering (voor weergave en veld Uitvoerdatum)
 * @param {string} [opts.probleemstelling]
 * @param {string} [opts.bevindingen]
 * @param {string} [opts.advies]
 * @param {string[]} [opts.fotos] - URLs of identifiers
 * @param {string[]} [opts.materialen]
 * @param {string} [opts.logoUrl] - Absolute URL van het logo (bijv. uit storage of instellingen); leeg = geen logo
 * @param {string} [opts.handtekeningUrl] - URL van handtekening klant (storage); getoond als ingevuld
 * @param {string} [opts.companyName] - Bedrijfsnaam voor footer (bijv. uit useOrganisatie().naam); leeg = alleen jaar
 */
export function generateWerkbonReportHtml({
  werkbonnummer = '',
  klantnaam = '',
  werkadres = '',
  referentie1 = '',
  referentie2 = '',
  uitvoerdatum = '',
  probleemstelling = '',
  bevindingen = '',
  advies = '',
  fotos = [],
  materialen = [],
  logoUrl = '',
  handtekeningUrl = '',
  companyName = '',
} = {}) {
  const fotosList = Array.isArray(fotos) ? fotos.filter(Boolean) : []
  const matList = Array.isArray(materialen) ? materialen.filter(Boolean) : []

  // Titel: "Rapport van [straat/nr]" en "in [plaats]" uit werkadres (bij komma: splitsen)
  const werkadresTrim = String(werkadres ?? '').trim()
  let rapportTitel = 'Rapport'
  let rapportSubtitel = ''
  if (werkadresTrim) {
    const commaIdx = werkadresTrim.indexOf(',')
    if (commaIdx > 0) {
      rapportTitel = `Rapport van ${werkadresTrim.slice(0, commaIdx).trim()}`
      rapportSubtitel = werkadresTrim.slice(commaIdx + 1).trim()
      if (rapportSubtitel) rapportSubtitel = `in ${rapportSubtitel}`
    } else {
      rapportTitel = `Rapport van ${werkadresTrim}`
    }
  }

  const uitvoerdatumStr = formatRapportDatum(uitvoerdatum)

  const fotoItems =
    fotosList.length > 0
      ? fotosList.map((x) => {
          const url = typeof x === 'string' ? x : x?.url || x?.href || ''
          if (url && (url.startsWith('http') || url.startsWith('//'))) {
            return `<li><img src="${esc(url)}" alt="" style="max-width: 100%; height: auto; border-radius: 8px;" loading="lazy" /></li>`
          }
          return `<li>${esc(String(x))}</li>`
        }).join('')
      : '<li>—</li>'

  const matItems =
    matList.length > 0
      ? matList.map((x) => `<li>${esc(typeof x === 'string' ? x : String(x))}</li>`).join('')
      : '<li>—</li>'

  const year = new Date().getFullYear()

  return `<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(rapportTitel)} ${esc(rapportSubtitel)}</title>
    <style>
      :root { color-scheme: light; --accent: #1e3a5f; --accent-soft: #2d4a6f; --text: #1e293b; --text-muted: #64748b; --border: #e2e8f0; --bg-soft: #f8fafc; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; font-family: "Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.6; color: var(--text); background: var(--bg-soft); }
      .page { max-width: 720px; margin: 0 auto; padding: 24px 16px; min-height: 100vh; }
      .card { background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); overflow: hidden; border: 2px solid rgb(221, 0, 0); }
      .brand-bar { height: 6px; background: rgb(221, 0, 0); width: 100%; flex-shrink: 0; }
      .content { padding: 20px 24px 28px; }
      .velden { display: grid; gap: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: #fff; }
      .veld { display: grid; grid-template-columns: 160px 1fr; gap: 16px; align-items: center; min-height: 44px; padding: 10px 14px; font-size: 14px; border-bottom: 1px solid var(--border); }
      .veld:last-child { border-bottom: none; }
      .veld:nth-child(even) { background: var(--bg-soft); }
      .veld-label { color: var(--text-muted); font-weight: 400; font-size: 13px; }
      .veld-waarde { color: var(--text); }
      h2.sectie { margin: 28px 0 12px; padding-bottom: 6px; font-size: 14px; font-weight: 400; color: var(--accent); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border); }
      h2.sectie:first-of-type { margin-top: 1.5em; }
      .block { padding: 12px 0; }
      .block p { margin: 0; color: var(--text); white-space: pre-wrap; font-size: 14px; }
      .block ul { margin: 8px 0 0 20px; padding: 0; font-size: 14px; }
      .block li { margin-bottom: 4px; }
      .foto-grid { list-style: none; margin: 12px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
      .foto-grid li { margin: 0; }
      .foto-grid img { width: 100%; height: auto; border-radius: 6px; border: 1px solid var(--border); display: block; }
      .report-footer { margin-top: 32px; margin-left: -24px; margin-right: -24px; padding: 14px 24px; background: rgb(221, 0, 0); color: #fff; font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; }
      .report-footer .footer-logo { max-height: 40px; width: auto; display: block; object-fit: contain; }
      .report-footer .footer-text { margin: 0; }
      @media print {
        body { background: #fff; font-size: 12pt; }
        .page { padding: 0; max-width: none; }
        .card { box-shadow: none; border: 2px solid rgb(221, 0, 0); }
        .brand-bar, .report-footer { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .veld:nth-child(even) { background: #f5f5f5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="card">
        <div class="brand-bar" aria-hidden="true"></div>
        <div class="content">
          <div class="velden">
            <div class="veld veld-combined">
              <span class="veld-label">Uitvoerdatum · Werkbonnummer</span>
              <span class="veld-waarde">${esc(uitvoerdatumStr || '—')} · ${esc(werkbonnummer || '—')}</span>
            </div>
            <div class="veld"><span class="veld-label">Opdrachtgever</span><span class="veld-waarde">${esc(klantnaam || '—')}</span></div>
            <div class="veld"><span class="veld-label">Werkadres</span><span class="veld-waarde">${esc(werkadresTrim || '—')}</span></div>
            ${referentie1 ? `<div class="veld"><span class="veld-label">Referentie 1</span><span class="veld-waarde">${esc(referentie1)}</span></div>` : ''}
            ${referentie2 ? `<div class="veld"><span class="veld-label">Referentie 2</span><span class="veld-waarde">${esc(referentie2)}</span></div>` : ''}
          </div>

          <h2 class="sectie">Probleemstelling / Doel onderzoek</h2>
          <div class="block"><p>${nl2br(probleemstelling) || '—'}</p></div>

          <h2 class="sectie">Bevindingen</h2>
          <div class="block"><p>${nl2br(bevindingen) || '—'}</p></div>

          <h2 class="sectie">Advies</h2>
          <div class="block"><p>${nl2br(advies) || '—'}</p></div>

          <h2 class="sectie">Afbeeldingen &amp; Video's</h2>
          <div class="block">
            <ul class="foto-grid">${fotoItems}</ul>
          </div>

          <h2 class="sectie">Materialen</h2>
          <div class="block">
            <ul>${matItems}</ul>
          </div>

          ${handtekeningUrl && (handtekeningUrl.startsWith('http') || handtekeningUrl.startsWith('//'))
            ? `
          <h2 class="sectie">Handtekening klant</h2>
          <div class="block handtekening-block" style="min-height: 100px;">
            <img src="${esc(handtekeningUrl)}" alt="Handtekening klant" style="max-width: 280px; max-height: 120px; display: block; object-fit: contain;" />
          </div>`
            : ''}

          <footer class="report-footer">
            ${logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(companyName || 'Logo')}" class="footer-logo" onerror="this.style.display='none'" />` : ''}
            <span class="footer-text">&copy; ${year}${companyName ? ` – ${esc(companyName)}` : ''}</span>
          </footer>
        </div>
      </div>
    </div>
  </body>
</html>`
}
