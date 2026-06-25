/**
 * Buitendienst – Mijn planning (binnen _rewrite)
 * Gebruikt useWerkbonnen.replaceWerkbonMaterieel en useArtikelen –zelfde route als ERP.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../auth/useAuth'
import { supabase } from '../../lib/supabaseClient'
import { useWerkbonnen } from '../../hooks/useWerkbonnen'
import { useArtikelen } from '../../hooks/useArtikelen'
import { useWerkbonLog, logTijdRegistratie } from '../../hooks/useWerkbonLog'
import { formatDateNL } from '../../lib/formatDateNL'
import { sendRapportageToKlant } from '../../lib/sendRapportageToKlant'
import { useOrganisatie } from '../../hooks/useOrganisatie'
import { useErpRole } from '../../auth/useErpRole'
import {
  getArbeidsloonSyncAantal,
  isOpnameWerkbon,
  magArbeidsloonAutomatischToevoegen,
  magBrandstoftoeslagToepassen,
  magTweedeManArbeidsloonKiezen,
  magVoorrijkostenToepassen,
} from '../../lib/werkbonPrijsregels'
import { magRapportageNaarOpdrachtgever } from '../../lib/werkbonVerplichteVelden'
import ArtikelSearchAdd from '../../components/pickers/ArtikelSearchAdd'

const VOORRIJKOSTEN_ARTIKELNUMMER = '1103'
const BRANDSTOFTOESLAG_ARTIKELNUMMER = '24052461'
const OPNAME_BOVENWATER_ARTIKELNUMMER = '989657'
const BUCKET_HANDTEKENING = 'werkbon-fotos'
const warnedMissingVoorrijkostenConfig = new Set()
const FOTO_UPLOAD_MAX_TOTAL_BYTES = 10 * 1024 * 1024

/** Is dit een arbeidsloon-artikelcode? 0030 t/m 0480 per 15 min. */
function isArbeidsloonCode(code) {
  const n = parseInt(String(code ?? '').trim(), 10)
  return n >= 30 && n <= 480 && n % 15 === 0
}

/** Normaliseer artikelnummer voor vergelijking (DB kan string '0045' of number 45 geven). */
function artikelnummerMatch(nr, minutesOrCode) {
  const s = String(nr ?? '').trim()
  const other = String(minutesOrCode)
  const pad = other.length <= 2 ? other.padStart(4, '0') : other
  return s === pad || s === other || parseInt(s, 10) === parseInt(minutesOrCode, 10)
}

/** Werkzaamheden-minuten afronden: min 30, stappen 15 (0,25 u). */
function roundWerkzaamhedenMinuten(rawMinutes) {
  const m = Number(rawMinutes)
  if (!Number.isFinite(m) || m <= 0) return 30
  return Math.max(30, Math.ceil(m / 15) * 15)
}
import { normalizeWerkbonStatus } from '../../lib/normalizeWerkbonStatus'
import LabelBadge from '../../components/LabelBadge'
import WerkbonnenZoekView from '../werkbonnen/WerkbonnenZoekView'
import MedewerkersPortaalView from '../portaal/MedewerkersPortaalView'
import { useAppPrefs } from '../../hooks/useAppPrefs'
import { PUSH_DEEPLINK_KEY } from '../../hooks/usePushNotifications'
import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
// ===== THEME (gelijk aan ERP: CSS-variabelen uit index.css) =====
const THEME = {
  brand: 'var(--app-accent)',
  brandSoft: 'var(--app-accent-soft)',
  text: 'var(--app-text)',
  border: 'var(--app-border)',
  bg: 'var(--app-bg)',
};
const ACTION_BUTTON_RED = '#dc2626';
const ACTION_BUTTON_RED_BORDER = '#b91c1c';

// ===== helpers =====
function ymd(d) {
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfWeekMonday(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // zo=0, ma=1 ... za=6
  const diffToMonday = (day + 6) % 7; // ma=0 ... zo=6
  d.setDate(d.getDate() - diffToMonday);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function safeArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try {
      const x = JSON.parse(val);
      return Array.isArray(x) ? x : [];
    } catch {
      return [];
    }
  }
  return [];
}

const BUITENDIENST_WERKBON_DRAFT_PREFIX = "buitendienst-werkbon-form:";

function emptyWerkbonForm() {
  return {
    bevindingen: "",
    advies: "",
    interne_referentie_buitendienst: "",
    klus_gereed: false,
    vervolg_nodig: false,
    arbeidsloon_tweede_man: false,
    fotos_urls: [],
    materialen: [],
  };
}

function werkbonFormDraftKey(werkbonId) {
  return `${BUITENDIENST_WERKBON_DRAFT_PREFIX}${werkbonId}`;
}

function buildWerkbonFormFromRecord(data, materialen) {
  return {
    bevindingen: data?.gekopieerd_van_werkbon_id ? "" : (data?.bevindingen ?? ""),
    advies: data?.advies ?? "",
    interne_referentie_buitendienst: data?.interne_referentie_buitendienst ?? "",
    klus_gereed: !!data?.klus_gereed,
    vervolg_nodig: !!data?.vervolg_nodig,
    arbeidsloon_tweede_man: !!data?.arbeidsloon_tweede_man,
    fotos_urls: safeArray(data?.fotos_urls),
    materialen: Array.isArray(materialen) ? materialen : [],
  };
}

function readWerkbonFormDraft(werkbonId) {
  if (!werkbonId) return null;
  try {
    const raw = sessionStorage.getItem(werkbonFormDraftKey(werkbonId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      bevindingen: parsed.bevindingen ?? "",
      advies: parsed.advies ?? "",
      interne_referentie_buitendienst: parsed.interne_referentie_buitendienst ?? "",
      klus_gereed: !!parsed.klus_gereed,
      vervolg_nodig: !!parsed.vervolg_nodig,
      arbeidsloon_tweede_man: !!parsed.arbeidsloon_tweede_man,
      fotos_urls: safeArray(parsed.fotos_urls),
      materialen: safeArray(parsed.materialen),
    };
  } catch {
    return null;
  }
}

function writeWerkbonFormDraft(werkbonId, formState) {
  if (!werkbonId || !formState) return;
  try {
    sessionStorage.setItem(
      werkbonFormDraftKey(werkbonId),
      JSON.stringify({
        bevindingen: formState.bevindingen ?? "",
        advies: formState.advies ?? "",
        interne_referentie_buitendienst: formState.interne_referentie_buitendienst ?? "",
        klus_gereed: !!formState.klus_gereed,
        vervolg_nodig: !!formState.vervolg_nodig,
        arbeidsloon_tweede_man: !!formState.arbeidsloon_tweede_man,
        fotos_urls: safeArray(formState.fotos_urls),
        materialen: safeArray(formState.materialen),
        savedAt: Date.now(),
      })
    );
  } catch {
    /* sessionStorage vol of niet beschikbaar */
  }
}

function clearWerkbonFormDraft(werkbonId) {
  if (!werkbonId) return;
  try {
    sessionStorage.removeItem(werkbonFormDraftKey(werkbonId));
  } catch {
    /* ignore */
  }
}

function mergeDbFormWithDraft(dbForm, draft) {
  if (!draft) return dbForm;
  return {
    ...dbForm,
    ...draft,
    materialen: draft.materialen.length > 0 ? draft.materialen : dbForm.materialen,
    fotos_urls: draft.fotos_urls.length > 0 ? draft.fotos_urls : dbForm.fotos_urls,
  };
}

function normalizePlanblok(planblok) {
  const s = String(planblok ?? "").toLowerCase();
  if (s.includes("hele") && s.includes("dag")) return "hele dag";
  if (s.includes("ochtend")) return "ochtend";
  if (s.includes("middag")) return "middag";
  return "";
}

function planblokOrder(planblok) {
  const pb = normalizePlanblok(planblok);
  if (pb === "ochtend" || pb === "hele dag") return 0;
  if (pb === "middag") return 1;
  return 2;
}

function formatBytesToMb(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '0.0'
  return (n / (1024 * 1024)).toFixed(1)
}

function getArtikelNummer(artikel) {
  return String(artikel?.artikelnummer ?? artikel?.artikel_nummer ?? '').trim()
}

function parsePrijsafspraakConfig(rawConfig) {
  if (!rawConfig) return null
  if (typeof rawConfig === 'object') return rawConfig
  if (typeof rawConfig === 'string') {
    try {
      const parsed = JSON.parse(rawConfig)
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

function getVoorrijkostenConfig(werkbon) {
  const cfg = werkbon?.klant?.prijsafspraak_config ?? werkbon?.prijsafspraak_config ?? null
  return parsePrijsafspraakConfig(cfg)
}

function isMissingPrijsafspraakConfigColumn(error) {
  const msg = String(error?.message ?? '').toLowerCase()
  return msg.includes('prijsafspraak_config') && msg.includes('does not exist')
}

function findVoorrijkostenArtikelForWerkbon(werkbon, artikelenList) {
  const list = Array.isArray(artikelenList) ? artikelenList : []
  if (!list.length) return null
  const cfg = getVoorrijkostenConfig(werkbon)
  const configuredId = String(cfg?.voorrijkosten_artikel_id ?? '').trim()
  const configuredNummer = String(cfg?.voorrijkosten_artikelnummer ?? '').trim()
  const configuredOmschrijving = String(cfg?.voorrijkosten_artikel_omschrijving ?? '').trim()

  const configuredArtikel = list.find((artikel) => {
    const idMatch = configuredId && String(artikel?.id ?? '') === configuredId
    const nummerMatch = configuredNummer && getArtikelNummer(artikel) === configuredNummer
    return idMatch || nummerMatch
  })
  if (configuredArtikel?.id) return configuredArtikel

  if (configuredId || configuredNummer) {
    const klantId = String(werkbon?.klant?.id ?? werkbon?.klant_id ?? 'onbekende-klant').trim() || 'onbekende-klant'
    const warnKey = `${klantId}|${configuredId}|${configuredNummer}`
    if (!warnedMissingVoorrijkostenConfig.has(warnKey)) {
      warnedMissingVoorrijkostenConfig.add(warnKey)
      console.warn(
        '[PlanningPageView] Klantspecifiek voorrijkostenartikel niet gevonden in actieve artikelenlijst; fallback naar 1103.',
        {
          werkbonId: werkbon?.id ?? null,
          klantId: werkbon?.klant?.id ?? werkbon?.klant_id ?? null,
          configuredArtikelId: configuredId || null,
          configuredArtikelnummer: configuredNummer || null,
          configuredOmschrijving: configuredOmschrijving || null,
        }
      )
    }
  }

  return list.find((artikel) => getArtikelNummer(artikel) === VOORRIJKOSTEN_ARTIKELNUMMER) || null
}

function findBrandstoftoeslagArtikelForWerkbon(werkbon, artikelenList, brandstofSettings) {
  const list = Array.isArray(artikelenList) ? artikelenList : []
  if (!list.length) return null
  if (!magBrandstoftoeslagToepassen(werkbon, brandstofSettings)) return null
  const configuredNummer = String(brandstofSettings?.artikelnummer ?? '').trim() || BRANDSTOFTOESLAG_ARTIKELNUMMER
  return list.find((artikel) => getArtikelNummer(artikel) === configuredNummer) || null
}

function isVoorrijkostenMatch(row, voorrijkostenArtikel) {
  const targetId = String(voorrijkostenArtikel?.id ?? '').trim()
  const targetNummer = getArtikelNummer(voorrijkostenArtikel)
  const rowArtikelId = String(row?.artikel_id ?? row?.artikel?.id ?? '').trim()
  const rowArtikelNummer = String(row?.artikelnummer ?? row?.artikel?.artikelnummer ?? row?.artikel?.artikel_nummer ?? '').trim()
  return (
    (!!targetId && rowArtikelId === targetId) ||
    (!!targetNummer && rowArtikelNummer === targetNummer)
  )
}

/**
 * Materiaalregel die door code-logica wordt afgedwongen:
 * - voorrijkosten
 * - brandstoftoeslag
 * - arbeidsloon (0030-0480, incl. opnamecode 989657)
 * Alleen deze regels blokkeren we in de buitendienst-UI.
 */
function isAutoLockedMateriaalRow(row, werkbon, artikelenList, brandstofSettings) {
  if (!row) return false
  const rowNummer = String(row?.artikelnummer ?? row?.artikel?.artikelnummer ?? row?.artikel?.artikel_nummer ?? '').trim()
  if (isArbeidsloonCode(rowNummer) || artikelnummerMatch(rowNummer, OPNAME_BOVENWATER_ARTIKELNUMMER)) {
    return true
  }
  const voorrijkostenArtikel = findVoorrijkostenArtikelForWerkbon(werkbon, artikelenList)
  if (voorrijkostenArtikel && isVoorrijkostenMatch(row, voorrijkostenArtikel)) return true
  const brandstoftoeslagArtikel = findBrandstoftoeslagArtikelForWerkbon(werkbon, artikelenList, brandstofSettings)
  if (brandstoftoeslagArtikel && isVoorrijkostenMatch(row, brandstoftoeslagArtikel)) return true
  return false
}

function calcAfhandelStatus({ klus_gereed, vervolg_nodig }) {
  if (klus_gereed === true && vervolg_nodig === false) return "te_verwerken";
  return "vervolgactie_noodzakelijk";
}

/** Effen statuskleuren voor bonkaarten. */
function bonStyleByStatus(status) {
  const fallback = { border: `1px solid ${THEME.border}`, background: "#374151", color: "white" };
  try {
    const s = normalizeWerkbonStatus(status);
    if (s === "wacht_op_akkoord" || s === "wacht op akkoord") {
      return { border: "1px solid #dc2626", background: "#dc2626", color: "white" };
    }
    if (s === "nog_in_te_plannen" || s === "nog in te plannen" || s === "noginteplannen") {
      return { border: "1px solid #5b21b6", background: "#7c3aed", color: "white" };
    }
    if (s === "ingepland" || s === "gepland") {
      return { border: "1px solid #1d4ed8", background: "#2563eb", color: "white" };
    }
    if (s === "klaar" || s === "afgerond" || s === "done") {
      return { border: "1px solid #15803d", background: "#16a34a", color: "white" };
    }
    if (s === "gefactureerd" || s === "afgehandeld") {
      return { border: "1px solid #475569", background: "#64748b", color: "white" };
    }
    if (s === "gearchiveerd") {
      return { border: "1px solid #78350f", background: "#92400e", color: "white" };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

// WB226/0001 of W226/0001 => { prefix:'WB' of 'W', serie:226, rest:'/0001' }
function parseWerkbonnummer(wb) {
  const s = String(wb || "").trim();
  const m = s.match(/^([A-Za-z]+)(\d{3})(.*)$/);
  if (!m) return null;
  return { prefix: m[1], serie: Number(m[2]), rest: m[3] || "" };
}

// WB226/0001 => ["WB126/0001","WB026/0001"]; W226/0001 => ["W126/0001","W026/0001"]
function buildEerdereBonnen(wb) {
  const p = parseWerkbonnummer(wb);
  if (!p) return [];
  const out = [];
  let n = p.serie - 100;
  while (n >= 0) {
    const num = String(n).padStart(3, "0");
    out.push(`${p.prefix}${num}${p.rest}`);
    n -= 100;
  }
  return out;
}

const BUCKET = "werkbon-fotos";

export default function MijnPlanningPage() {
  const { user, logout } = useAuth();
  const { organisatieId, isUitvoerder, medewerkerId: huidigMedewerkerId } = useErpRole();
  const { logoUrl, naam } = useOrganisatie();
  const { prefs, setPref } = useAppPrefs();

  // mini-router
  const [page, setPage] = useState("planning"); // planning | werkbonnen | werkbonHistorie | portaal | instellingen
  const [alleBonnenContext, setAlleBonnenContext] = useState(null);

  // Push deep link: open specifieke werkbon na tap op push-melding
  useEffect(() => {
    try {
      const werkbonId = localStorage.getItem(PUSH_DEEPLINK_KEY)
      if (werkbonId) {
        localStorage.removeItem(PUSH_DEEPLINK_KEY)
        setPage("planning")
        setSelectedBonId(werkbonId)
      }
    } catch { /* storage blocked */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // medewerker
  const [medewerker, setMedewerker] = useState(null);
  const [medewerkerErr, setMedewerkerErr] = useState("");

  // views
  const [view, setView] = useState(() => prefs.defaultView || "werkweek"); // vandaag | werkweek | heleweek
  // uitvoerder: eigen planning vs totale planning
  const [planningModus, setPlanningModus] = useState("eigen"); // 'eigen' | 'totaal'
  const [weekOffset, setWeekOffset] = useState(0);
  const [dayOffset, setDayOffset] = useState(0);

  // bonnen lijst (planning)
  const [bonnen, setBonnen] = useState([]);
  const [bonnenLoading, setBonnenLoading] = useState(false);
  const [bonnenError, setBonnenError] = useState("");

  const { replaceWerkbonMaterieel } = useWerkbonnen({ enableRealtime: false })
  const { artikelen = [], error: artikelenError } = useArtikelen()
  const artikelenErr = artikelenError?.message ?? ''

  // modal
  const [selectedBonId, setSelectedBonId] = useState(null);
  const [selectedBon, setSelectedBon] = useState(null); // full record
  const { addStatusWijziging } = useWerkbonLog(selectedBon?.id ?? null);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState("");

  // invulvelden (modal form)
  const [form, setForm] = useState(() => emptyWerkbonForm());

  /** Voorkomt dat herladen van dezelfde bon onopgeslagen form wist (bijv. na foto-picker op mobiel). */
  const loadedFormBonIdRef = useRef(null);
  const formDirtyRef = useRef(false);
  const skipFormDraftSyncRef = useRef(false);

  // upload state
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const fotoSizeCacheRef = useRef(new Map())
  const [brandstofSettings, setBrandstofSettings] = useState({
    enabled: false,
    artikelnummer: BRANDSTOFTOESLAG_ARTIKELNUMMER,
  });

  // handtekening (canvas data URL; optioneel, veld verborgen tot knop "handtekening toevoegen")
  const [handtekeningDataUrl, setHandtekeningDataUrl] = useState("");
  const [showHandtekeningVeld, setShowHandtekeningVeld] = useState(false);
  const handtekeningCanvasRef = useRef(null);

  // alle werkbonnen pagina data
  const [alleBonnen, setAlleBonnen] = useState([]);
  const [alleBonnenLoading, setAlleBonnenLoading] = useState(false);
  const [alleBonnenErr, setAlleBonnenErr] = useState("");

  // "Onderweg naar klant" / "Begin werkzaamheden" vanaf de planlijst (zonder modal open)
  const [onderwegBusyId, setOnderwegBusyId] = useState(null);
  const [beginWerkBusyId, setBeginWerkBusyId] = useState(null);

  // detail popup (bij klik op een bon uit Historie of Voorgaande)
  const [detailPopupBonId, setDetailPopupBonId] = useState(null);
  const [detailPopupBon, setDetailPopupBon] = useState(null);
  const [detailPopupLoading, setDetailPopupLoading] = useState(false);
  const [detailPopupErr, setDetailPopupErr] = useState("");
  // document title
  useEffect(() => {
    const prev = document.title;
    document.title = "Buitendienst – Mijn planning";
    return () => { document.title = prev; };
  }, []);

  // Eénmalige log zodat je in de console ziet of de echte planning-UI laadt (niet de oude placeholder)
  useEffect(() => {
    console.log("Buitendienst: planning-UI geladen (weekoverzicht + bonnen)");
  }, []);

  // medewerker ophalen (medewerkers.user_id = auth.uid())
  useEffect(() => {
    if (!user) {
      setMedewerker(null);
      setMedewerkerErr("");
      return;
    }

    supabase
      .from("medewerkers")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          setMedewerker(null);
          setMedewerkerErr(error.message);
          return;
        }
        setMedewerker(data ?? null);
        setMedewerkerErr("");
      });
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    async function loadBrandstofSettings() {
      const orgId = organisatieId ?? "a0000000-0000-0000-0000-000000000001";
      const { data, error } = await supabase
        .from("instellingen")
        .select("key, value")
        .in("key", ["brandstoftoeslag_enabled", "brandstoftoeslag_artikelnummer"])
        .eq("organisatie_id", orgId);

      if (cancelled || error) return;

      const map = {};
      (data ?? []).forEach((row) => {
        map[row.key] = row.value ?? "";
      });

      setBrandstofSettings({
        enabled: String(map.brandstoftoeslag_enabled ?? "").trim() === "1",
        artikelnummer:
          String(map.brandstoftoeslag_artikelnummer ?? BRANDSTOFTOESLAG_ARTIKELNUMMER).trim() ||
          BRANDSTOFTOESLAG_ARTIKELNUMMER,
      });
    }

    loadBrandstofSettings();
    return () => {
      cancelled = true;
    };
  }, [organisatieId]);

  // date-range (vandaag/week)
  const { rangeStart, rangeEnd, days } = useMemo(() => {
    if (view === "vandaag") {
      const base = new Date();
      base.setDate(base.getDate() + dayOffset);
      const d = ymd(base);
      return { rangeStart: d, rangeEnd: d, days: [{ label: "Dag", date: d }] };
    }

    const base = new Date();
    base.setDate(base.getDate() + weekOffset * 7);

    const monday = startOfWeekMonday(base);
    const end = view === "werkweek" ? addDays(monday, 4) : addDays(monday, 6);

    const labelsWerkweek = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag"];
    const labelsHeleWeek = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag", "Zondag"];
    const labels = view === "werkweek" ? labelsWerkweek : labelsHeleWeek;

    const list = labels.map((label, i) => ({ label, date: ymd(addDays(monday, i)) }));

    return { rangeStart: ymd(monday), rangeEnd: ymd(end), days: list };
  }, [view, weekOffset, dayOffset]);

  // bonnen ophalen voor range (gepland, klaar, afgehandeld voor deze monteur; DB enum heeft geen "gefactureerd")
  const fetchBonnen = async () => {
    if (!medewerker) return;

    setBonnenLoading(true);
    setBonnenError("");
    const selectWithPrijsafspraak = "id, werkbonnummer, plandatum, planblok, plan_volgorde, werkomschrijving, interne_referentie, interne_referentie_buitendienst, status, label, created_at, onderweg_start, werkzaamheden_start, werk_straat, werk_huisnummer, werk_toevoeging, werk_postcode, werk_plaats, medewerker_id, gekopieerd_van_werkbon_id, medewerker:medewerkers(naam), klant:klanten(id, naam, prijsafspraak_config), werkbon_categorieen ( id, naam )"
    const selectFallback = "id, werkbonnummer, plandatum, planblok, plan_volgorde, werkomschrijving, interne_referentie, interne_referentie_buitendienst, status, label, created_at, onderweg_start, werkzaamheden_start, werk_straat, werk_huisnummer, werk_toevoeging, werk_postcode, werk_plaats, medewerker_id, gekopieerd_van_werkbon_id, medewerker:medewerkers(naam), klant:klanten(id, naam), werkbon_categorieen ( id, naam )"

    const isTotaal = isUitvoerder && planningModus === "totaal";

    const runListQuery = (selectClause) => {
      let q = supabase
        .from("werkbonnen")
        .select(selectClause)
        .in("status", ["gepland", "ingepland", "klaar", "afgehandeld"])
        .is("archived_at", null)
        .gte("plandatum", rangeStart)
        .lte("plandatum", rangeEnd)
        .order("plandatum", { ascending: true })
        .order("plan_volgorde", { ascending: true, nullsFirst: false })
        .order("planblok", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: true });
      if (!isTotaal) q = q.eq("medewerker_id", medewerker.id);
      return q;
    };

    let { data, error } = await runListQuery(selectWithPrijsafspraak)
    if (error && isMissingPrijsafspraakConfigColumn(error)) {
      const retry = await runListQuery(selectFallback)
      data = retry.data
      error = retry.error
    }

    setBonnenLoading(false);

    if (error) {
      setBonnen([]);
      setBonnenError(error.message);
      return;
    }

    setBonnen(data ?? []);
  };

  useEffect(() => {
    fetchBonnen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medewerker, rangeStart, rangeEnd, planningModus]);

  // groeperen per dag
  const grouped = useMemo(() => {
    const map = {};
    for (const d of days) map[d.date] = [];
    for (const b of bonnen) {
      const key = String(b.plandatum || "").slice(0, 10);
      if (!map[key]) map[key] = [];
      map[key].push(b);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        const pa = planblokOrder(a?.planblok);
        const pb = planblokOrder(b?.planblok);
        if (pa !== pb) return pa - pb;

        const oa = Number.isFinite(Number(a?.plan_volgorde)) ? Number(a.plan_volgorde) : 999999;
        const ob = Number.isFinite(Number(b?.plan_volgorde)) ? Number(b.plan_volgorde) : 999999;
        if (oa !== ob) return oa - ob;

        return String(a?.werkbonnummer ?? a?.id ?? "").localeCompare(String(b?.werkbonnummer ?? b?.id ?? ""));
      });
    }
    return map;
  }, [bonnen, days]);

  // Concept lokaal bewaren zolang de bon open is (o.a. na app op achtergrond door camera).
  useEffect(() => {
    if (!selectedBonId) return;
    if (skipFormDraftSyncRef.current) {
      skipFormDraftSyncRef.current = false;
      return;
    }
    formDirtyRef.current = true;
    writeWerkbonFormDraft(selectedBonId, form);
  }, [form, selectedBonId]);

  // modal: werkbon volledig ophalen bij open
  useEffect(() => {
    if (!selectedBonId) {
      setSelectedBon(null);
      setModalError("");
      setModalBusy(false);
      setUploadErr("");
      setUploadBusy(false);
      loadedFormBonIdRef.current = null;
      formDirtyRef.current = false;
      skipFormDraftSyncRef.current = false;

      skipFormDraftSyncRef.current = true;
      setForm(emptyWerkbonForm());

      setShowHandtekeningVeld(false);
      return;
    }

    const openingBonId = selectedBonId;
    if (loadedFormBonIdRef.current !== null && loadedFormBonIdRef.current !== openingBonId) {
      formDirtyRef.current = false;
    }

    setModalBusy(true);
    setModalError("");
    setUploadErr("");
    setUploadBusy(false);
    setShowHandtekeningVeld(false);

    const baseCols = [
      "id",
      "werkbonnummer",
      "plandatum",
      "planblok",
      "werkomschrijving",
      "interne_referentie",
      "interne_referentie_buitendienst",
      "status",
      "medewerker_id",
      "bevindingen",
      "advies",
      "klus_gereed",
      "vervolg_nodig",
      "afhandel_status",
      "fotos_urls",
      "materialen",
      "werk_postcode",
      "werk_huisnummer",
      "werk_toevoeging",
      "werk_straat",
      "werk_plaats",
      "gekopieerd_van_werkbon_id",
      "label",
      "onderweg_start",
      "werkzaamheden_start",
      "werkzaamheden_eind",
      "aanrijtijd_minuten",
      "werkuren_minuten",
      "handtekening_url",
      "arbeidsloon_tweede_man",
    ];

    const selectWithPrijsafspraak = `${baseCols.join(", ")}, klant:klanten(id, naam, prijsafspraak_config)`
    const selectFallback = `${baseCols.join(", ")}, klant:klanten(id, naam)`
    const runSingleQuery = (selectClause) =>
      supabase
        .from("werkbonnen")
        .select(selectClause)
        .eq("id", selectedBonId)
        .single()

    runSingleQuery(selectWithPrijsafspraak)
      .then(async ({ data, error }) => {
        if (error && isMissingPrijsafspraakConfigColumn(error)) {
          const retry = await runSingleQuery(selectFallback)
          data = retry.data
          error = retry.error
        }
        if (openingBonId !== selectedBonId) return;

        if (error) {
          setModalBusy(false);
          setSelectedBon(null);
          setModalError(error.message);
          return;
        }
        setSelectedBon(data);

        if (formDirtyRef.current) {
          loadedFormBonIdRef.current = openingBonId;
          setModalBusy(false);
          return;
        }

        let materialen = safeArray(data?.materialen);
        const { data: materieelRows } = await supabase
          .from("werkbon_materieel")
          .select("artikel_id, aantal, artikel:artikelen(id, omschrijving, artikelnummer, eenheid, prijs)")
          .eq("werkbon_id", openingBonId);
        if (Array.isArray(materieelRows) && materieelRows.length > 0) {
          materialen = materieelRows.map((m) => ({
            artikel_id: m?.artikel_id ?? m?.artikel?.id,
            naam: m?.artikel?.omschrijving ?? "",
            artikelnummer: m?.artikel?.artikelnummer ?? null,
            eenheid: m?.artikel?.eenheid ?? null,
            prijs: m?.artikel?.prijs ?? null,
            qty: m?.aantal ?? 1,
          }));
        }

        const dbForm = buildWerkbonFormFromRecord(data, materialen);
        const draft = readWerkbonFormDraft(openingBonId);
        const nextForm = mergeDbFormWithDraft(dbForm, draft);

        skipFormDraftSyncRef.current = true;
        setForm(nextForm);
        formDirtyRef.current = !!draft;
        loadedFormBonIdRef.current = openingBonId;
        setHandtekeningDataUrl("");
        setModalBusy(false);
      })
      .catch((err) => {
        setModalBusy(false);
        setSelectedBon(null);
        setModalError(err?.message || "Fout bij laden werkbon.");
      });
  }, [selectedBonId]);

  // mag bewerken? (ingepland = gepland; normalizeWerkbonStatus behandelt beide)
  const canEdit = useMemo(() => {
    if (!selectedBon || !medewerker) return false;
    return normalizeWerkbonStatus(selectedBon.status) === "gepland" && selectedBon.medewerker_id === medewerker.id;
  }, [selectedBon, medewerker]);

  async function uploadFilesToBucket(files) {
    if (!selectedBon) return;

    const selectedFiles = Array.isArray(files) ? files : []
    const selectedBytes = selectedFiles.reduce((sum, file) => sum + (Number(file?.size) || 0), 0)
    if (selectedBytes > FOTO_UPLOAD_MAX_TOTAL_BYTES) {
      setUploadErr(
        `Foto's te groot: ${formatBytesToMb(selectedBytes)} MB geselecteerd. Maximaal ${formatBytesToMb(FOTO_UPLOAD_MAX_TOTAL_BYTES)} MB per uploadactie.`
      )
      return
    }

    setUploadBusy(true);
    setUploadErr("");

    const uploadedUrls = [];
    const uploadedUrlSizes = [];

    for (const file of selectedFiles) {
      const safeName = String(file.name || "foto").replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${selectedBon.id}/${Date.now()}_${safeName}`;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });

      if (upErr) {
        setUploadBusy(false);
        setUploadErr(upErr.message);
        return;
      }

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      if (data?.publicUrl) {
        uploadedUrls.push(data.publicUrl)
        uploadedUrlSizes.push({
          url: data.publicUrl,
          bytes: Number(file?.size) || 0,
        })
      }
    }

    const cache = fotoSizeCacheRef.current
    for (const item of uploadedUrlSizes) {
      cache.set(item.url, item.bytes)
    }

    setForm((f) => ({ ...f, fotos_urls: [...safeArray(f.fotos_urls), ...uploadedUrls] }));
    setUploadBusy(false);
  }
  /** Native camera (iOS) of foto-bibliotheek — converteert naar File voor uploadFilesToBucket */
  async function takeFotoNative(source) {
    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: source ?? CameraSource.Prompt,
        quality: 82,
        allowEditing: false,
        width: 1920,
        presentationStyle: 'fullScreen',
      })
      if (!photo?.dataUrl) return
      const res = await fetch(photo.dataUrl)
      const blob = await res.blob()
      const ext = photo.format === 'png' ? 'png' : 'jpg'
      const file = new File([blob], `foto_${Date.now()}.${ext}`, {
        type: blob.type || `image/${ext}`,
      })
      await uploadFilesToBucket([file])
    } catch (err) {
      if (String(err).includes('cancelled') || String(err).includes('canceled')) return
      setUploadErr(err?.message || 'Camerafout.')
    }
  }

  /** Zelfde route als ERP: useWerkbonnen.replaceWerkbonMaterieel (delete + insert werkbon_materieel). */
  async function saveMaterialenToWerkbon(werkbonId, materialenArray) {
    const items = safeArray(materialenArray ?? form.materialen)
    const valid = items
      .filter((m) => {
        const id = m?.artikel_id
        const n = Number(m?.aantal ?? m?.qty ?? 0) || 0
        return id != null && id !== '' && n > 0
      })
      .map((m) => ({ artikel_id: m.artikel_id, aantal: Number(m.aantal ?? m.qty ?? 1) || 1 }))
    if (items.length > 0 && valid.length === 0) {
      throw new Error('Geen geldige materialen: controleer dat elk regel een artikel en aantal > 0 heeft.')
    }
    const res = await replaceWerkbonMaterieel(werkbonId, valid)
    if (res?.error) throw new Error(res.error.message)
  }

  /** Bij "Onderweg": voorrijkosten één keer toevoegen aan werkbon_materieel, alleen op parent (niet op child). Eerste in de lijst. */
  async function addVoorrijkostenToWerkbonIfNeeded(werkbonId, werkbon, artikelenList) {
    if (!werkbonId || !artikelenList?.length) return
    if (werkbon?.gekopieerd_van_werkbon_id) return
    if (!magVoorrijkostenToepassen(werkbon)) return
    const voorrijkostenArtikel = findVoorrijkostenArtikelForWerkbon(werkbon, artikelenList)
    if (!voorrijkostenArtikel?.id) return
    const { data: currentRows } = await supabase
      .from("werkbon_materieel")
      .select("artikel_id, aantal")
      .eq("werkbon_id", werkbonId)
    const hasAlready = (currentRows ?? []).some((r) => isVoorrijkostenMatch(r, voorrijkostenArtikel))
    if (hasAlready) return
    const existing = (currentRows ?? []).map((r) => ({ artikel_id: r.artikel_id, aantal: r.aantal ?? 1 }))
    const newList = [
      { artikel_id: voorrijkostenArtikel.id, aantal: 1 },
      ...existing,
    ]
    const res = await replaceWerkbonMaterieel(werkbonId, newList)
    if (res?.error) throw res.error
  }

  async function addBrandstoftoeslagToWerkbonIfNeeded(werkbonId, werkbon, artikelenList) {
    if (!werkbonId || !artikelenList?.length) return
    const brandstoftoeslagArtikel = findBrandstoftoeslagArtikelForWerkbon(werkbon, artikelenList, brandstofSettings)
    if (!brandstoftoeslagArtikel?.id) return
    const { data: currentRows } = await supabase
      .from("werkbon_materieel")
      .select("artikel_id, aantal")
      .eq("werkbon_id", werkbonId)
    const hasAlready = (currentRows ?? []).some((r) => isVoorrijkostenMatch(r, brandstoftoeslagArtikel))
    if (hasAlready) return
    const existing = (currentRows ?? []).map((r) => ({ artikel_id: r.artikel_id, aantal: r.aantal ?? 1 }))
    const newList = [
      ...existing,
      { artikel_id: brandstoftoeslagArtikel.id, aantal: 1 },
    ]
    const res = await replaceWerkbonMaterieel(werkbonId, newList)
    if (res?.error) throw res.error
  }

  function ensureAutomatischeMateriaalRegels(materialenArray, werkbon, artikelenList) {
    const materialen = safeArray(materialenArray).map((m) => ({ ...m }))

    const voorrijkostenArtikel = findVoorrijkostenArtikelForWerkbon(werkbon, artikelenList)
    const heeftVoorrijkosten = voorrijkostenArtikel
      ? materialen.some((m) => isVoorrijkostenMatch(m, voorrijkostenArtikel))
      : false
    if (
      !werkbon?.gekopieerd_van_werkbon_id &&
      magVoorrijkostenToepassen(werkbon) &&
      voorrijkostenArtikel &&
      !heeftVoorrijkosten
    ) {
      materialen.unshift({
        artikel_id: voorrijkostenArtikel.id,
        naam: voorrijkostenArtikel.omschrijving ?? "Voorrijkosten B1",
        artikelnummer: voorrijkostenArtikel.artikelnummer ?? voorrijkostenArtikel.artikel_nummer ?? VOORRIJKOSTEN_ARTIKELNUMMER,
        eenheid: voorrijkostenArtikel.eenheid ?? null,
        prijs: voorrijkostenArtikel.prijs ?? null,
        qty: 1,
      })
    }

    const brandstoftoeslagArtikel = findBrandstoftoeslagArtikelForWerkbon(werkbon, artikelenList, brandstofSettings)
    const heeftBrandstoftoeslag = brandstoftoeslagArtikel
      ? materialen.some((m) => isVoorrijkostenMatch(m, brandstoftoeslagArtikel))
      : false
    if (brandstoftoeslagArtikel && !heeftBrandstoftoeslag) {
      materialen.push({
        artikel_id: brandstoftoeslagArtikel.id,
        naam: brandstoftoeslagArtikel.omschrijving ?? "Brandstoftoeslag",
        artikelnummer: brandstoftoeslagArtikel.artikelnummer ?? brandstoftoeslagArtikel.artikel_nummer ?? BRANDSTOFTOESLAG_ARTIKELNUMMER,
        eenheid: brandstoftoeslagArtikel.eenheid ?? null,
        prijs: brandstoftoeslagArtikel.prijs ?? null,
        qty: 1,
      })
    }

    return materialen
  }

  /** Na "Einde werkzaamheden": bewaar alle bestaande regels en vervang alleen arbeidsloon door één regel (0030–0480). */
  async function syncArbeidsloonToWerkbonMaterieel(werkbonId, werkbon, werkurenMinuten, artikelenList, currentMaterialen = null) {
    if (!werkbonId || !artikelenList?.length) return
    const isOpnameBon = isOpnameWerkbon(werkbon)
    const min = Math.min(480, Math.max(30, roundWerkzaamhedenMinuten(werkurenMinuten)))
    const nr = (a) => a?.artikelnummer ?? a?.artikel_nummer ?? ''
    const arbeidsloonArtikel = artikelenList.find((a) => (
      isOpnameBon
        ? artikelnummerMatch(nr(a), OPNAME_BOVENWATER_ARTIKELNUMMER)
        : artikelnummerMatch(nr(a), min)
    ))
    if (!arbeidsloonArtikel?.id) return
    const voorrijkostenArtikel = findVoorrijkostenArtikelForWerkbon(werkbon, artikelenList)
    let rows = safeArray(currentMaterialen)
      .filter((m) => m?.artikel_id != null && m?.artikel_id !== '')
      .map((m) => ({
        artikel_id: m.artikel_id,
        aantal: Number(m.aantal ?? m.qty ?? 1) || 1,
        artikelnummer: String(m?.artikelnummer ?? '').trim(),
      }))

    if (rows.length === 0) {
      const { data: currentRows } = await supabase
        .from('werkbon_materieel')
        .select('artikel_id, aantal, artikel:artikelen(id, artikelnummer, artikel_nummer)')
        .eq('werkbon_id', werkbonId)
      rows = (currentRows ?? []).map((r) => ({
        artikel_id: r.artikel_id,
        aantal: Number(r.aantal ?? 1) || 1,
        artikelnummer: getArtikelNummer(r?.artikel),
      }))
    }

    const rowsZonderArbeidsloon = rows.filter((r) => {
      if (isArbeidsloonCode(r?.artikelnummer)) return false
      if (isOpnameBon && artikelnummerMatch(r?.artikelnummer, OPNAME_BOVENWATER_ARTIKELNUMMER)) return false
      return true
    })
    const voorrijkosten = rowsZonderArbeidsloon.filter((r) => isVoorrijkostenMatch(r, voorrijkostenArtikel))
    const overige = rowsZonderArbeidsloon.filter((r) => !isVoorrijkostenMatch(r, voorrijkostenArtikel))
    const arbeidsloonAantal = getArbeidsloonSyncAantal(werkbon)
    const newList = [
      ...voorrijkosten.map((r) => ({ artikel_id: r.artikel_id, aantal: r.aantal ?? 1 })),
      { artikel_id: arbeidsloonArtikel.id, aantal: arbeidsloonAantal },
      ...overige.map((r) => ({ artikel_id: r.artikel_id, aantal: r.aantal ?? 1 })),
    ]
    const res = await replaceWerkbonMaterieel(werkbonId, newList)
    if (res?.error) throw res.error
  }

  /**
   * Bewaart materialen met veiligheidsnet:
   * - automatische regels (voorrijkosten/brandstof) blijven behouden
   * - arbeidsloon wordt opnieuw afgedwongen zodra werkuren al zijn berekend
   */
  async function saveMaterialenMetArbeidsloonGuard(werkbon, materialenArray) {
    if (!werkbon?.id) return
    const materialenVoorOpslag = ensureAutomatischeMateriaalRegels(materialenArray, werkbon, artikelen ?? [])
    const werkurenMinuten = Number(werkbon?.werkuren_minuten ?? 0)
    if (magArbeidsloonAutomatischToevoegen(werkbon) && Number.isFinite(werkurenMinuten) && werkurenMinuten > 0) {
      await syncArbeidsloonToWerkbonMaterieel(
        werkbon.id,
        werkbon,
        werkurenMinuten,
        artikelen ?? [],
        materialenVoorOpslag
      )
      return
    }
    await saveMaterialenToWerkbon(werkbon.id, materialenVoorOpslag)
  }

  async function handleSave() {
    if (!selectedBon) return;

    setModalBusy(true);
    setModalError("");

    const arbeidsloonTweedeMan = magTweedeManArbeidsloonKiezen(selectedBon) ? !!form.arbeidsloon_tweede_man : false
    const payload = {
      bevindingen: form.bevindingen || null,
      advies: form.advies || null,
      klus_gereed: !!form.klus_gereed,
      vervolg_nodig: !!form.vervolg_nodig,
      arbeidsloon_tweede_man: arbeidsloonTweedeMan,
      ingevuld_door: medewerker?.id ?? null,
      ingevuld_op: new Date().toISOString(),
      afhandel_status: calcAfhandelStatus({
        klus_gereed: !!form.klus_gereed,
        vervolg_nodig: !!form.vervolg_nodig,
      }),
      fotos_urls: safeArray(form.fotos_urls),
    };

    try {
      const { data: updated, error } = await supabase
        .from("werkbonnen")
        .update(payload)
        .eq("id", selectedBon.id)
        .select("id")
        .single();

      if (error) {
        setModalError(error.message);
        return;
      }

      const werkbonVoorMaterieel = { ...selectedBon, ...payload }
      await saveMaterialenMetArbeidsloonGuard(werkbonVoorMaterieel, form.materialen)
      setSelectedBon((prev) => (prev ? { ...prev, ...payload } : prev))
      await fetchBonnen()
    } catch (err) {
      setModalError(err?.message || "Fout bij opslaan materialen.");
    } finally {
      setModalBusy(false);
    }
  }

  async function handleKlaar() {
    if (!selectedBon) return;

    setModalBusy(true);
    setModalError("");

    let handtekeningUrl = selectedBon.handtekening_url ?? null;
    if (handtekeningDataUrl && handtekeningCanvasRef.current) {
      try {
        const blob = await fetch(handtekeningDataUrl).then((r) => r.blob());
        const path = `handtekeningen/${selectedBon.id}.png`;
        const { error: upErr } = await supabase.storage.from(BUCKET_HANDTEKENING).upload(path, blob, { cacheControl: "3600", upsert: true });
        if (!upErr) {
          const { data: pub } = supabase.storage.from(BUCKET_HANDTEKENING).getPublicUrl(path);
          handtekeningUrl = pub?.publicUrl ?? path;
        }
      } catch (_) {}
    }

    const arbeidsloonTweedeMan = magTweedeManArbeidsloonKiezen(selectedBon) ? !!form.arbeidsloon_tweede_man : false
    const payload = {
      status: "klaar",
      ingevuld_door: medewerker?.id ?? null,
      ingevuld_op: new Date().toISOString(),
      afgehandeld_op: new Date().toISOString(),
      afhandel_status: calcAfhandelStatus({
        klus_gereed: !!form.klus_gereed,
        vervolg_nodig: !!form.vervolg_nodig,
      }),
      bevindingen: form.bevindingen || null,
      advies: form.advies || null,
      interne_referentie_buitendienst: form.interne_referentie_buitendienst?.trim() || null,
      klus_gereed: !!form.klus_gereed,
      vervolg_nodig: !!form.vervolg_nodig,
      arbeidsloon_tweede_man: arbeidsloonTweedeMan,
      fotos_urls: safeArray(form.fotos_urls),
      handtekening_url: handtekeningUrl,
    };

    try {
      const { error } = await supabase
        .from("werkbonnen")
        .update(payload)
        .eq("id", selectedBon.id)
        .select("id")
        .single();

      if (error) {
        setModalError(error.message);
        return;
      }

      const logRes = await addStatusWijziging(selectedBon.status ?? null, "klaar");
      if (logRes?.error) console.warn("Logboek statuswijziging (buitendienst):", logRes.error);

      const werkbonVoorMaterieel = { ...selectedBon, ...payload }
      await saveMaterialenMetArbeidsloonGuard(werkbonVoorMaterieel, form.materialen)
      setSelectedBon((prev) => (prev ? { ...prev, ...payload } : prev))

      const magMailNaarOpdrachtgever = magRapportageNaarOpdrachtgever({
        ...selectedBon,
        vervolg_nodig: !!form.vervolg_nodig,
      });
      if (magMailNaarOpdrachtgever) {
        const emailRes = await sendRapportageToKlant(selectedBon.id, supabase, {
          fallbackTo: user?.email ?? undefined,
          logoUrl,
          companyName: naam,
        });
        if (!emailRes.success) {
          setModalError(emailRes.error || "E-mail rapportage verzenden mislukt.");
          return;
        }
      }

      clearWerkbonFormDraft(selectedBon.id);
      formDirtyRef.current = false;
      loadedFormBonIdRef.current = null;
      setSelectedBonId(null);
      await fetchBonnen();
    } catch (err) {
      setModalError(err?.message || "Fout bij opslaan materialen.");
    } finally {
      setModalBusy(false);
    }
  }

  /** "Onderweg naar klant" vanaf de planlijst (zonder modal). Werkt ook voor huidige selectedBon. */
  async function handleOnderwegFromList(bon) {
    const werkbonId = bon?.id
    if (!werkbonId || !medewerker) return
    const s = String(bon?.status ?? "").toLowerCase().trim();
    if ((s !== "gepland" && s !== "ingepland") || bon.onderweg_start) return;
    setOnderwegBusyId(werkbonId)
    try {
      const now = new Date().toISOString()
      const { error } = await supabase.from("werkbonnen").update({ onderweg_start: now }).eq("id", werkbonId).select("id").single()
      if (error) throw new Error(error.message)
      const logRes = await logTijdRegistratie(werkbonId, "Onderweg naar klant")
      if (logRes?.error) console.warn("Logboek tijdsregistratie:", logRes.error)
      await addVoorrijkostenToWerkbonIfNeeded(werkbonId, bon, artikelen ?? [])
      await addBrandstoftoeslagToWerkbonIfNeeded(werkbonId, bon, artikelen ?? [])
      setBonnen((prev) => prev.map((x) => (x.id === werkbonId ? { ...x, onderweg_start: now } : x)))
      if (selectedBon?.id === werkbonId) setSelectedBon((prev) => (prev ? { ...prev, onderweg_start: now } : prev))
      // Als de modal voor deze bon openstaat: voorrijkosten ook in form.materialen (eerste in lijst)
      if (selectedBonId === werkbonId) {
        const voorrijkostenArtikel = findVoorrijkostenArtikelForWerkbon(bon, artikelen ?? [])
        if (!bon.gekopieerd_van_werkbon_id && magVoorrijkostenToepassen(bon) && voorrijkostenArtikel) {
          setForm((f) => {
            const hasAlready = safeArray(f.materialen).some((m) => isVoorrijkostenMatch(m, voorrijkostenArtikel))
            if (hasAlready) return f
            const row = {
              artikel_id: voorrijkostenArtikel.id,
              naam: voorrijkostenArtikel.omschrijving ?? "Voorrijkosten B1",
              artikelnummer: voorrijkostenArtikel.artikelnummer ?? voorrijkostenArtikel.artikel_nummer ?? VOORRIJKOSTEN_ARTIKELNUMMER,
              eenheid: voorrijkostenArtikel.eenheid ?? null,
              prijs: voorrijkostenArtikel.prijs ?? null,
              qty: 1,
            }
            return { ...f, materialen: [row, ...safeArray(f.materialen)] }
          })
        }
        const brandstoftoeslagArtikel = findBrandstoftoeslagArtikelForWerkbon(bon, artikelen ?? [], brandstofSettings)
        if (brandstoftoeslagArtikel) {
          setForm((f) => {
            const hasAlready = safeArray(f.materialen).some((m) => isVoorrijkostenMatch(m, brandstoftoeslagArtikel))
            if (hasAlready) return f
            const row = {
              artikel_id: brandstoftoeslagArtikel.id,
              naam: brandstoftoeslagArtikel.omschrijving ?? "Brandstoftoeslag",
              artikelnummer: brandstoftoeslagArtikel.artikelnummer ?? brandstoftoeslagArtikel.artikel_nummer ?? BRANDSTOFTOESLAG_ARTIKELNUMMER,
              eenheid: brandstoftoeslagArtikel.eenheid ?? null,
              prijs: brandstoftoeslagArtikel.prijs ?? null,
              qty: 1,
            }
            return { ...f, materialen: [...safeArray(f.materialen), row] }
          })
        }
      }
    } catch (err) {
      console.error("Onderweg vanaf lijst:", err)
    } finally {
      setOnderwegBusyId(null)
    }
  }

  /** "Begin werkzaamheden" vanaf de planlijst (zonder modal). Alleen als onderweg_start al gezet is. */
  async function handleBeginWerkzaamhedenFromList(bon) {
    const werkbonId = bon?.id
    if (!werkbonId) return
    if (!bon?.onderweg_start || bon?.werkzaamheden_start) return
    setBeginWerkBusyId(werkbonId)
    try {
      const now = new Date().toISOString()
      const { error } = await supabase.from("werkbonnen").update({ werkzaamheden_start: now }).eq("id", werkbonId).select("id").single()
      if (error) throw new Error(error.message)
      const logRes = await logTijdRegistratie(werkbonId, "Begin werkzaamheden")
      if (logRes?.error) console.warn("Logboek tijdsregistratie:", logRes.error)
      setBonnen((prev) => prev.map((x) => (x.id === werkbonId ? { ...x, werkzaamheden_start: now } : x)))
      if (selectedBon?.id === werkbonId) setSelectedBon((prev) => (prev ? { ...prev, werkzaamheden_start: now } : prev))
    } catch (err) {
      console.error("Begin werkzaamheden vanaf lijst:", err)
    } finally {
      setBeginWerkBusyId(null)
    }
  }

  async function handleVerplaatsNaarMij() {
    if (!selectedBon?.id || !medewerker) return
    setModalBusy(true)
    setModalError("")
    try {
      const { error } = await supabase
        .from("werkbonnen")
        .update({ medewerker_id: medewerker.id })
        .eq("id", selectedBon.id)
      if (error) throw error
      setSelectedBonId(null)
      setPlanningModus("eigen")
      await fetchBonnen()
    } catch (err) {
      setModalError(err?.message ?? "Verplaatsen mislukt")
    } finally {
      setModalBusy(false)
    }
  }

  async function handleOnderwegNaarKlant() {
    if (!selectedBon?.id) return
    setModalBusy(true)
    setModalError("")
    try {
      const now = new Date().toISOString()
      const { error } = await supabase.from("werkbonnen").update({ onderweg_start: now }).eq("id", selectedBon.id).select("id").single()
      if (error) {
        setModalError(error.message)
        return
      }
      const logRes = await logTijdRegistratie(selectedBon.id, "Onderweg naar klant")
      if (logRes?.error) console.warn("Logboek tijdsregistratie:", logRes.error)
      setSelectedBon((prev) => (prev ? { ...prev, onderweg_start: now } : prev))
      // Voorrijkosten alleen op parent, één keer, eerste in de lijst; persisteren naar DB + UI
      if (!selectedBon.gekopieerd_van_werkbon_id) {
        await addVoorrijkostenToWerkbonIfNeeded(selectedBon.id, selectedBon, artikelen ?? [])
        const voorrijkostenArtikel = findVoorrijkostenArtikelForWerkbon(selectedBon, artikelen ?? [])
        if (magVoorrijkostenToepassen(selectedBon) && voorrijkostenArtikel) {
          const hasAlready = safeArray(form.materialen).some((m) => isVoorrijkostenMatch(m, voorrijkostenArtikel))
          if (!hasAlready) {
            const voorrijkostenRow = {
              artikel_id: voorrijkostenArtikel.id,
              naam: voorrijkostenArtikel.omschrijving ?? "Voorrijkosten B1",
              artikelnummer: voorrijkostenArtikel.artikelnummer ?? voorrijkostenArtikel.artikel_nummer ?? VOORRIJKOSTEN_ARTIKELNUMMER,
              eenheid: voorrijkostenArtikel.eenheid ?? null,
              prijs: voorrijkostenArtikel.prijs ?? null,
              qty: 1,
            }
            setForm((f) => ({
              ...f,
              materialen: [voorrijkostenRow, ...safeArray(f.materialen)],
            }))
          }
        }
      }
      await addBrandstoftoeslagToWerkbonIfNeeded(selectedBon.id, selectedBon, artikelen ?? [])
      const brandstoftoeslagArtikel = findBrandstoftoeslagArtikelForWerkbon(selectedBon, artikelen ?? [], brandstofSettings)
      if (brandstoftoeslagArtikel) {
        const hasAlready = safeArray(form.materialen).some((m) => isVoorrijkostenMatch(m, brandstoftoeslagArtikel))
        if (!hasAlready) {
          const brandstoftoeslagRow = {
            artikel_id: brandstoftoeslagArtikel.id,
            naam: brandstoftoeslagArtikel.omschrijving ?? "Brandstoftoeslag",
            artikelnummer: brandstoftoeslagArtikel.artikelnummer ?? brandstoftoeslagArtikel.artikel_nummer ?? BRANDSTOFTOESLAG_ARTIKELNUMMER,
            eenheid: brandstoftoeslagArtikel.eenheid ?? null,
            prijs: brandstoftoeslagArtikel.prijs ?? null,
            qty: 1,
          }
          setForm((f) => ({
            ...f,
            materialen: [...safeArray(f.materialen), brandstoftoeslagRow],
          }))
        }
      }
    } catch (err) {
      setModalError(err?.message || "Fout bij start onderweg.")
    } finally {
      setModalBusy(false)
    }
  }

  async function handleBeginWerkzaamheden() {
    if (!selectedBon?.id) return
    setModalBusy(true)
    setModalError("")
    try {
      const now = new Date().toISOString()
      const { error } = await supabase.from("werkbonnen").update({ werkzaamheden_start: now }).eq("id", selectedBon.id).select("id").single()
      if (error) {
        setModalError(error.message)
        return
      }
      const logRes = await logTijdRegistratie(selectedBon.id, "Begin werkzaamheden")
      if (logRes?.error) console.warn("Logboek tijdsregistratie:", logRes.error)
      setSelectedBon((prev) => (prev ? { ...prev, werkzaamheden_start: now } : prev))
    } catch (err) {
      setModalError(err?.message || "Fout bij start werkzaamheden.")
    } finally {
      setModalBusy(false)
    }
  }

  async function handleEindeWerkzaamheden() {
    if (!selectedBon?.id || !selectedBon?.werkzaamheden_start) return
    setModalBusy(true)
    setModalError("")
    try {
      const now = new Date()
      const nowIso = now.toISOString()
      const start = new Date(selectedBon.werkzaamheden_start).getTime()
      const rawWerkzaamhedenMin = Math.round((now.getTime() - start) / 60000)
      const werkurenMin = roundWerkzaamhedenMinuten(rawWerkzaamhedenMin)
      const onderwegStart = selectedBon.onderweg_start ? new Date(selectedBon.onderweg_start).getTime() : null
      const aanrijtijdMin = onderwegStart != null ? Math.round((start - onderwegStart) / 60000) : null
      let handtekeningUrl = selectedBon.handtekening_url ?? null
      if (handtekeningDataUrl && handtekeningCanvasRef.current) {
        try {
          const blob = await fetch(handtekeningDataUrl).then((r) => r.blob())
          const path = `handtekeningen/${selectedBon.id}.png`
          const { error: upErr } = await supabase.storage.from(BUCKET_HANDTEKENING).upload(path, blob, { cacheControl: "3600", upsert: true })
          if (!upErr) {
            const { data: pub } = supabase.storage.from(BUCKET_HANDTEKENING).getPublicUrl(path)
            handtekeningUrl = pub?.publicUrl ?? path
          }
        } catch (_) {}
      }
      const arbeidsloonTweedeMan = magTweedeManArbeidsloonKiezen(selectedBon) ? !!form.arbeidsloon_tweede_man : false
      const updatePayload = {
        werkzaamheden_eind: nowIso,
        aanrijtijd_minuten: aanrijtijdMin,
        werkuren_minuten: werkurenMin,
        handtekening_url: handtekeningUrl,
        arbeidsloon_tweede_man: arbeidsloonTweedeMan,
      }
      const { error } = await supabase.from("werkbonnen").update(updatePayload).eq("id", selectedBon.id).select("id").single()
      if (error) {
        setModalError(error.message)
        return
      }
      const logRes = await logTijdRegistratie(selectedBon.id, "Einde werkzaamheden")
      if (logRes?.error) console.warn("Logboek tijdsregistratie:", logRes.error)
      const werkbonVoorSync = { ...selectedBon, ...updatePayload }
      setSelectedBon((prev) => (prev ? { ...prev, ...updatePayload } : prev))
      const materialenVoorOpslag = ensureAutomatischeMateriaalRegels(form.materialen, werkbonVoorSync, artikelen ?? [])
      if (magArbeidsloonAutomatischToevoegen(werkbonVoorSync)) {
        await syncArbeidsloonToWerkbonMaterieel(werkbonVoorSync.id, werkbonVoorSync, werkurenMin, artikelen ?? [], materialenVoorOpslag)
      } else {
        await saveMaterialenToWerkbon(selectedBon.id, materialenVoorOpslag)
      }
      const { data: materieelRows } = await supabase
        .from("werkbon_materieel")
        .select("artikel_id, aantal, artikel:artikelen(id, omschrijving, artikelnummer, eenheid, prijs)")
        .eq("werkbon_id", selectedBon.id)
      if (Array.isArray(materieelRows) && materieelRows.length > 0) {
        const materialen = materieelRows.map((m) => ({
          artikel_id: m?.artikel_id ?? m?.artikel?.id,
          naam: m?.artikel?.omschrijving ?? "",
          artikelnummer: m?.artikel?.artikelnummer ?? null,
          eenheid: m?.artikel?.eenheid ?? null,
          prijs: m?.artikel?.prijs ?? null,
          qty: m?.aantal ?? 1,
        }))
        setForm((f) => ({ ...f, materialen }))
      }
    } catch (err) {
      setModalError(err?.message || "Fout bij einde werkzaamheden.")
    } finally {
      setModalBusy(false)
    }
  }

  // ===== materialen helpers =====
  function parseMateriaalAantal(value) {
    const qty = Number(value);
    return Number.isFinite(qty) && qty > 0 ? qty : 1;
  }

  function addHandmatigMateriaal(art) {
    if (!art?.id) return;
    const row = {
      artikel_id: art.id,
      naam: art.omschrijving ?? "",
      artikelnummer: art.artikelnummer ?? art.artikel_nummer ?? null,
      eenheid: art.eenheid ?? null,
      prijs: art.prijs ?? null,
      qty: 1,
    };
    if (isAutoLockedMateriaalRow(row, selectedBon, artikelen ?? [], brandstofSettings)) {
      return;
    }
    setForm((f) => ({
      ...f,
      materialen: [...safeArray(f.materialen), row],
    }));
  }

  function updateMateriaalAantal(idx, value) {
    setForm((f) => {
      const list = [...safeArray(f.materialen)];
      const row = list[idx];
      if (!row || isAutoLockedMateriaalRow(row, selectedBon, artikelen ?? [], brandstofSettings)) {
        return f;
      }
      list[idx] = { ...row, qty: value };
      return { ...f, materialen: list };
    });
  }

  function commitMateriaalAantal(idx, value) {
    const amount = parseMateriaalAantal(value);
    setForm((f) => {
      const list = [...safeArray(f.materialen)];
      const row = list[idx];
      if (!row || isAutoLockedMateriaalRow(row, selectedBon, artikelen ?? [], brandstofSettings)) {
        return f;
      }
      list[idx] = { ...row, qty: amount };
      return { ...f, materialen: list };
    });
  }

  function removeMateriaal(idx) {
    setForm((f) => {
      const list = [...safeArray(f.materialen)];
      const target = list[idx]
      if (isAutoLockedMateriaalRow(target, selectedBon, artikelen ?? [], brandstofSettings)) {
        return f
      }
      list.splice(idx, 1);
      return { ...f, materialen: list };
    });
  }

  function removeFoto(idx) {
    setForm((f) => {
      const list = [...safeArray(f.fotos_urls)];
      const removedUrl = list[idx]
      if (removedUrl) {
        fotoSizeCacheRef.current.delete(String(removedUrl))
      }
      list.splice(idx, 1);
      return { ...f, fotos_urls: list };
    });
  }

  // ===== Alle Werkbonnen: laden op basis van context =====
  async function loadAlleBonnen(ctx) {
    if (!ctx) return;

    setAlleBonnen([]);
    setAlleBonnenErr("");
    setAlleBonnenLoading(true);

    // 1) historie op adres (werkadres = postcode + huisnummer)
    if (ctx.type === "historie_op_adres") {
      const postcode = String(ctx.postcode ?? "").trim().toUpperCase();
      const huisnummer = String(ctx.huisnummer ?? "").trim();

      if (!postcode || !huisnummer) {
        setAlleBonnenLoading(false);
        setAlleBonnenErr("Geen postcode/huisnummer gevonden op deze werkbon.");
        return;
      }

      const { data, error } = await supabase
        .from("werkbonnen")
        .select(
          "id, werkbonnummer, plandatum, planblok, status, afhandel_status, werk_postcode, werk_huisnummer, werk_toevoeging, werk_straat, werk_plaats"
        )
        .eq("werk_postcode", postcode)
        .eq("werk_huisnummer", huisnummer)
        .order("plandatum", { ascending: false });

      setAlleBonnenLoading(false);

      if (error) {
        setAlleBonnenErr(error.message);
        return;
      }

      setAlleBonnen(data ?? []);
      return;
    }

    // 2) eerdere bonnen op nummer
    if (ctx.type === "eerdere_bonnen") {
      const list = Array.isArray(ctx.eerdere) ? ctx.eerdere : [];
      if (list.length === 0) {
        setAlleBonnenLoading(false);
        setAlleBonnenErr("Geen eerdere bonnen gevonden op basis van nummer.");
        return;
      }

      const { data, error } = await supabase
        .from("werkbonnen")
        .select(
          "id, werkbonnummer, plandatum, planblok, status, afhandel_status, werk_postcode, werk_huisnummer, werk_toevoeging, werk_straat, werk_plaats"
        )
        .in("werkbonnummer", list)
        .order("plandatum", { ascending: false });

      setAlleBonnenLoading(false);

      if (error) {
        setAlleBonnenErr(error.message);
        return;
      }

      setAlleBonnen(data ?? []);
      return;
    }

    setAlleBonnenLoading(false);
    setAlleBonnenErr("Onbekende context.");
  }

  // als je naar Alle Werkbonnen gaat: direct laden (alleen als context gezet is)
  useEffect(() => {
    if (page !== "alleWerkbonnen" || !alleBonnenContext) return;
    loadAlleBonnen(alleBonnenContext);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, alleBonnenContext]);

  // detail popup: volledige bon ophalen (ongeacht status)
  useEffect(() => {
    if (!detailPopupBonId) {
      setDetailPopupBon(null);
      setDetailPopupErr("");
      return;
    }
    setDetailPopupBon(null);
    setDetailPopupErr("");
    setDetailPopupLoading(true);
    supabase
      .from("werkbonnen")
      .select(
        "id, werkbonnummer, werkomschrijving, bevindingen, advies, interne_referentie, fotos_urls, werk_straat, werk_huisnummer, werk_toevoeging, werk_postcode, werk_plaats, klant:klanten(naam)"
      )
      .eq("id", detailPopupBonId)
      .single()
      .then(({ data, error }) => {
        setDetailPopupLoading(false);
        if (error) {
          setDetailPopupErr(error.message);
          return;
        }
        setDetailPopupBon(data);
      })
      .catch((err) => {
        setDetailPopupLoading(false);
        setDetailPopupErr(err?.message || "Fout bij laden.");
      });
  }, [detailPopupBonId]);

  // ===== popup knoppen =====
  function openHistorie() {
    setAlleBonnenContext({
      type: "historie_op_adres",
      bon_id: selectedBon?.id ?? null,
      postcode: selectedBon?.werk_postcode ?? null,
      huisnummer: selectedBon?.werk_huisnummer ?? null,
      werkbonnummer: selectedBon?.werkbonnummer ?? null,
    });
    setPage("werkbonHistorie");
  }

  function openEerdereBonnen() {
    setAlleBonnenContext({
      type: "eerdere_bonnen",
      bon_id: selectedBon?.id ?? null,
      werkbonnummer: selectedBon?.werkbonnummer ?? null,
      eerdere: buildEerdereBonnen(selectedBon?.werkbonnummer),
    });
    setPage("werkbonHistorie");
  }

  // ===== Bottom navigation icons =====
  const NAV_ITEMS = [
    {
      id: "planning",
      label: "Planning",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <line x1="8" y1="14" x2="8" y2="14" strokeWidth="2.5" />
          <line x1="12" y1="14" x2="12" y2="14" strokeWidth="2.5" />
          <line x1="16" y1="14" x2="16" y2="14" strokeWidth="2.5" />
        </svg>
      ),
    },
    {
      id: "werkbonnen",
      label: "Werkbonnen",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      ),
    },
    {
      id: "portaal",
      label: "Portaal",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      ),
    },
    {
      id: "instellingen",
      label: "Instellingen",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
  ];

  function getActiveTab() {
    if (page === "werkbonHistorie") return "werkbonnen";
    return page;
  }

  function renderBottomNav() {
    const activeTab = getActiveTab();
    return (
      <nav className="app-bottom-nav" aria-label="Navigatie">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`app-bottom-nav__item${activeTab === item.id ? " app-bottom-nav__item--active" : ""}`}
            onClick={() => setPage(item.id)}
            aria-label={item.label}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    );
  }

  // ===== Werkbon-historie (context: adres/eerdere bonnen, vanuit planning) =====
  if (page === "werkbonHistorie") {
    const title =
      alleBonnenContext?.type === "historie_op_adres"
        ? "Historie op dit adres"
        : alleBonnenContext?.type === "eerdere_bonnen"
        ? "Voorgaande bon(nen)"
        : "Alle Werkbonnen";

    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: THEME.bg }}>
        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: 16 }}>
        {/* Zelfde header als planning-scherm */}
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            padding: 12,
            border: `1px solid ${THEME.border}`,
            borderRadius: 14,
            background: 'var(--app-panel)',
            boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img
              src={logoUrl || '/logo/logo.png'}
              alt={naam || 'Logo'}
              style={{ height: 40, width: "auto", maxWidth: 260, objectFit: "contain", objectPosition: "left center", opacity: 0.9, marginRight: 12, flexShrink: 0 }}
              onError={(e) => { e.target.onerror = null; e.target.style.display = "none"; }}
            />
            <div>
              <div style={{ fontWeight: "normal", color: THEME.brand }}>Buitendienst</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>Ingelogd als: {user?.email ?? ""} ({medewerker?.naam || "—"})</div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              setDetailPopupBonId(null);
              setPage("planning");
              setAlleBonnenContext(null);
            }}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: `1px solid ${THEME.border}`,
              background: 'var(--app-panel)',
              fontWeight: "normal",
            }}
          >
            ← Terug
          </button>
          <div style={{ fontWeight: "normal", color: THEME.text }}>{title}</div>
        </div>

        <div style={{ marginTop: 10, opacity: 0.75, fontSize: 12 }}>
          {alleBonnenContext?.type === "historie_op_adres" ? (
            <>
              Adres: {alleBonnenContext?.postcode || "—"} {alleBonnenContext?.huisnummer || "—"}
            </>
          ) : null}
          {alleBonnenContext?.type === "eerdere_bonnen" ? <>Werkbon: {alleBonnenContext?.werkbonnummer || "—"}</> : null}
        </div>

        {alleBonnenLoading ? <div style={{ marginTop: 12 }}>Laden...</div> : null}
        {alleBonnenErr ? <div style={{ marginTop: 12, color: "red" }}>{alleBonnenErr}</div> : null}

        <div style={{ marginTop: 12 }}>
          {alleBonnen.length === 0 && !alleBonnenLoading && !alleBonnenErr ? <div>— geen resultaten —</div> : null}

          {alleBonnen.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setDetailPopupBonId(b.id)}
              style={{
                width: "100%",
                textAlign: "left",
                border: `1px solid ${THEME.border}`,
                padding: 10,
                marginTop: 8,
                background: 'var(--app-panel)',
                borderRadius: 12,
                boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: "normal" }}>{b.werkbonnummer}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{b.plandatum ? formatDateNL(b.plandatum) : "—"}</div>
              </div>
              <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                {b.status || "—"} • {b.planblok || "—"} • {b.afhandel_status || "—"}
              </div>
              <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                {b.werk_straat || ""} {b.werk_huisnummer || ""} {b.werk_toevoeging || ""}, {b.werk_postcode || ""}{" "}
                {b.werk_plaats || ""}
              </div>
            </button>
          ))}
        </div>

        {/* Detail popup: gegevens geselecteerde bon (klant, adres, werkomschrijving, bevindingen, advies, interne opmerkingen, foto's) */}
        {detailPopupBonId ? (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 25,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.6)",
            }}
            onClick={() => setDetailPopupBonId(null)}
          >
            <div
              style={{
                background: 'var(--app-panel)',
                border: `1px solid ${THEME.border}`,
                borderRadius: 14,
                padding: 20,
                maxWidth: 480,
                width: "95%",
                maxHeight: "90vh",
                overflow: "auto",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {detailPopupLoading ? (
                <div>Laden...</div>
              ) : detailPopupErr ? (
                <div style={{ color: "red" }}>{detailPopupErr}</div>
              ) : detailPopupBon ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div style={{ fontWeight: "normal", fontSize: 16 }}>{detailPopupBon.werkbonnummer || "—"}</div>
                    <button
                      type="button"
                      onClick={() => setDetailPopupBonId(null)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 10,
                        border: `1px solid ${THEME.border}`,
                        background: 'var(--app-panel)',
                        fontWeight: "normal",
                      }}
                    >
                      Sluiten
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 14 }}>
                    <div>
                      <div style={{ fontWeight: "normal", opacity: 0.85, marginBottom: 4 }}>Werkbonnummer</div>
                      <div>{detailPopupBon.werkbonnummer ?? "—"}</div>
                    </div>
                    <div>
                      <div style={{ fontWeight: "normal", opacity: 0.85, marginBottom: 4 }}>Klantnaam</div>
                      <div>{detailPopupBon.klant?.naam ?? "—"}</div>
                    </div>
                    <div>
                      <div style={{ fontWeight: "normal", opacity: 0.85, marginBottom: 4 }}>Werkadres</div>
                      <div>
                        {[detailPopupBon.werk_straat, detailPopupBon.werk_huisnummer, detailPopupBon.werk_toevoeging]
                          .filter(Boolean)
                          .join(" ")}
                        {detailPopupBon.werk_postcode || detailPopupBon.werk_plaats
                          ? `, ${[detailPopupBon.werk_postcode, detailPopupBon.werk_plaats].filter(Boolean).join(" ")}`
                          : ""}
                        {![detailPopupBon.werk_straat, detailPopupBon.werk_huisnummer, detailPopupBon.werk_toevoeging, detailPopupBon.werk_postcode, detailPopupBon.werk_plaats].some(Boolean)
                          ? "—"
                          : ""}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontWeight: "normal", opacity: 0.85, marginBottom: 4 }}>Werkomschrijving</div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{detailPopupBon.werkomschrijving || "—"}</div>
                    </div>
                    <div>
                      <div style={{ fontWeight: "normal", opacity: 0.85, marginBottom: 4 }}>Bevindingen</div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{detailPopupBon.bevindingen || "—"}</div>
                    </div>
                    <div>
                      <div style={{ fontWeight: "normal", opacity: 0.85, marginBottom: 4 }}>Advies</div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{detailPopupBon.advies || "—"}</div>
                    </div>
                    <div>
                      <div style={{ fontWeight: "normal", opacity: 0.85, marginBottom: 4 }}>Interne opmerkingen</div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{detailPopupBon.interne_referentie || "—"}</div>
                    </div>
                    <div>
                      <div style={{ fontWeight: "normal", opacity: 0.85, marginBottom: 4 }}>Foto&apos;s</div>
                      {safeArray(detailPopupBon.fotos_urls).length === 0 ? (
                        <div>— geen foto&apos;s —</div>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginTop: 4 }}>
                          {safeArray(detailPopupBon.fotos_urls).map((url, idx) => (
                            <img
                              key={`${url}-${idx}`}
                              src={url}
                              alt=""
                              style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 8 }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
        </div>
        {renderBottomNav()}
      </div>
    );
  }

  // ===== Werkbonnen zoeken (tab) =====
  if (page === "werkbonnen") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--app-bg, #0a1628)" }}>
        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
          <WerkbonnenZoekView logoUrl={logoUrl} naam={naam} />
        </div>

        {renderBottomNav()}
      </div>
    );
  }

  // ===== Portaal pagina =====
  if (page === "portaal") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: THEME.bg }}>
        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
          <MedewerkersPortaalView />
        </div>
        {renderBottomNav()}
      </div>
    );
  }

  // ===== Instellingen pagina =====
  if (page === "instellingen") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: THEME.bg }}>
        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: 16 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <img
            src={logoUrl || '/logo/logo.png'}
            alt={naam || 'Logo'}
            style={{ height: 32, width: "auto", maxWidth: 100, objectFit: "contain", opacity: 0.9, flexShrink: 0 }}
            onError={(e) => { e.target.onerror = null; e.target.style.display = "none"; }}
          />
          <div style={{ fontSize: 16, fontWeight: "normal", color: THEME.brand }}>Instellingen</div>
        </div>

        {/* ── Weergave ── */}
        <SettingsGroup label="Weergave">
          <SettingsToggleRow
            label="Donker thema"
            sublabel="Schakel tussen donker en licht thema"
            value={prefs.theme === 'dark'}
            onChange={v => setPref('theme', v ? 'dark' : 'light')}
          />
          <SettingsToggleRow
            label="Toon afgehandelde bonnen in planning"
            sublabel="Afgehandelde / gefactureerde werkbonnen zichtbaar in dagoverzicht"
            value={prefs.showAfgehandeldInPlanning}
            onChange={v => setPref('showAfgehandeldInPlanning', v)}
          />
          <SettingsSelectRow
            label="Standaard weergave"
            sublabel="Welke weergave bij openen van de planning"
            value={prefs.defaultView}
            options={[
              { value: 'vandaag', label: 'Vandaag' },
              { value: 'werkweek', label: 'Werkweek' },
              { value: 'heleweek', label: 'Hele week' },
            ]}
            onChange={v => { setPref('defaultView', v); setView(v); }}
          />
        </SettingsGroup>

        {/* ── Meldingen ── */}
        <SettingsGroup label="Meldingen">
          <SettingsToggleRow
            label="Pushberichten"
            sublabel="Ontvang meldingen over nieuwe werkbonnen en updates"
            value={prefs.pushEnabled}
            onChange={v => setPref('pushEnabled', v)}
          />
        </SettingsGroup>

        {/* ── Account ── */}
        <SettingsGroup label="Account">
          <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 14, color: THEME.text }}>Ingelogd als</div>
              <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>{user?.email ?? "—"}</div>
            </div>
          </div>
          {medewerker && (
            <div style={{ padding: "12px 16px", borderTop: `1px solid ${THEME.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 14, color: THEME.text }}>Naam</div>
                <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>{medewerker.naam}</div>
              </div>
            </div>
          )}
          <div style={{ padding: "12px 16px", borderTop: `1px solid ${THEME.border}` }}>
            <button
              type="button"
              onClick={logout}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid rgba(239,68,68,0.4)",
                background: "rgba(239,68,68,0.08)",
                color: "#f87171",
                fontWeight: "normal",
                fontSize: 14,
                cursor: "pointer",
                textAlign: "center",
                fontFamily: "inherit",
              }}
            >
              Uitloggen
            </button>
          </div>
        </SettingsGroup>

        {/* ── App-info ── */}
        <div style={{ marginTop: 20, padding: "10px 14px", borderRadius: 10, textAlign: "center" }}>
          <div style={{ fontSize: 12, opacity: 0.35 }}>Montiqu Buitendienst · v1.0.0</div>
        </div>

        </div>
        {renderBottomNav()}
      </div>
    );
  }

  // ===== planning scherm =====
  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: THEME.bg }}
      data-page="buitendienst-planning"
    >
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "12px 16px 16px" }}>

      {/* ── Compacte header ─────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 14,
        background: "var(--app-panel)",
        border: `1px solid ${THEME.border}`,
        boxShadow: "0 1px 6px rgba(0,0,0,0.08)",
        marginBottom: 18,
      }}>
        <img
          src={logoUrl || '/logo/logo.png'}
          alt={naam || 'Logo'}
          style={{ height: 36, width: "auto", maxWidth: 120, objectFit: "contain", objectPosition: "left center", flexShrink: 0 }}
          onError={(e) => { e.target.onerror = null; e.target.style.display = "none"; }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: THEME.brand }}>Buitendienst</div>
          <div style={{ fontSize: 11, opacity: 0.65, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {user.email} &middot; {medewerker?.naam || "—"}
          </div>
        </div>
      </div>

      {medewerkerErr ? <div style={{ color: "red", marginBottom: 10, fontSize: 13 }}>{medewerkerErr}</div> : null}
      {!medewerker && !medewerkerErr ? (
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 12, border: `1px solid ${THEME.border}`, background: "var(--app-panel)", fontSize: 13, color: "var(--app-text)" }}>
          Geen medewerker gekoppeld aan dit account.
        </div>
      ) : null}

      {/* ── Paginatitel + Eigen/Totaal toggle (uitvoerder only) ─────────── */}
      {medewerker ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "var(--app-text)" }}>
            {isUitvoerder && planningModus === "totaal" ? "Totale planning" : "Mijn planning"}
          </h1>
          {isUitvoerder ? (
            <div style={{
              display: "flex",
              background: "var(--app-panel)",
              border: `1px solid ${THEME.border}`,
              borderRadius: 10,
              padding: 2,
              gap: 2,
            }}>
              {[
                { key: "eigen", label: "👤 Eigen" },
                { key: "totaal", label: "👥 Totaal" },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setPlanningModus(key)}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 8,
                    border: "none",
                    fontSize: 12,
                    fontWeight: planningModus === key ? 600 : 400,
                    cursor: "pointer",
                    background: planningModus === key ? THEME.brand : "transparent",
                    color: planningModus === key ? "#fff" : "var(--app-text)",
                    fontFamily: "inherit",
                    transition: "background 150ms",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Segmented view-selector ──────────────────────────────────────── */}
      <div style={{
        display: "flex",
        background: "var(--app-panel)",
        border: `1px solid ${THEME.border}`,
        borderRadius: 12,
        padding: 3,
        gap: 2,
        marginBottom: 12,
      }}>
        {[
          { key: "vandaag", label: "Vandaag", onClick: () => { setView("vandaag"); setDayOffset(0); } },
          { key: "werkweek", label: "Werkweek", onClick: () => setView("werkweek") },
          { key: "heleweek", label: "Hele week", onClick: () => setView("heleweek") },
        ].map(({ key, label, onClick }) => (
          <button
            key={key}
            onClick={onClick}
            style={{
              flex: 1,
              padding: "8px 4px",
              borderRadius: 9,
              border: "none",
              fontSize: 13,
              fontWeight: view === key ? 600 : 400,
              cursor: "pointer",
              transition: "background 150ms, color 150ms",
              background: view === key ? THEME.brand : "transparent",
              color: view === key ? "#fff" : "var(--app-text)",
              fontFamily: "inherit",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Navigatiebalk ────────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 16,
        background: "var(--app-panel)",
        border: `1px solid ${THEME.border}`,
        borderRadius: 12,
        padding: "6px 8px",
      }}>
        <button
          onClick={() => view === "vandaag" ? setDayOffset((x) => x - 1) : setWeekOffset((w) => w - 1)}
          style={{
            flexShrink: 0,
            width: 36, height: 36,
            borderRadius: 9,
            border: `1px solid ${THEME.border}`,
            background: "var(--app-panel2)",
            color: "var(--app-text)",
            fontSize: 16,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          aria-label="vorige"
        >‹</button>

        <div style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 500, color: "var(--app-text)", lineHeight: 1.3 }}>
          {view === "vandaag"
            ? formatDateNL(rangeStart)
            : <>{formatDateNL(rangeStart)}<br /><span style={{ opacity: 0.55 }}>t/m</span> {formatDateNL(rangeEnd)}</>
          }
        </div>

        <button
          onClick={() => view === "vandaag" ? setDayOffset((x) => x + 1) : setWeekOffset((w) => w + 1)}
          style={{
            flexShrink: 0,
            width: 36, height: 36,
            borderRadius: 9,
            border: `1px solid ${THEME.border}`,
            background: "var(--app-panel2)",
            color: "var(--app-text)",
            fontSize: 16,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          aria-label="volgende"
        >›</button>
      </div>

      {bonnenLoading ? <div style={{ marginTop: 12 }}>Laden...</div> : null}
      {bonnenError ? <div style={{ marginTop: 12, color: "red" }}>{bonnenError}</div> : null}
      {medewerker && !bonnenLoading && !bonnenError && bonnen.length === 0 ? (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: `1px solid ${THEME.border}`, background: "var(--app-panel)", color: "var(--app-text)" }}>
          Geen werkbonnen in deze periode. Kies een andere week of controleer in het ERP of er werkbonnen aan jou zijn toegewezen.
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        {days.map((d) => (
          <div key={d.date} style={{ marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>
              {d.label} ({formatDateNL(d.date)})
            </h3>

            {(grouped[d.date] ?? []).length === 0 ? (
              <div style={{ marginTop: 6 }}>— geen werkbonnen —</div>
            ) : (
              (grouped[d.date] ?? []).map((b, idx) => {
                const bonId = b?.id ?? `bon-${d.date}-${idx}`;
                const blok = b?.planblok ?? "—";
                const categorieNaam = b?.werkbon_categorieen?.naam ?? (Array.isArray(b?.werkbon_categorieen) ? b?.werkbon_categorieen?.[0]?.naam : null);
                const status = b?.status ?? "";
                const statusNorm = String(status).toLowerCase().trim();
                const omschrijvingVolledig = String(b?.interne_referentie ?? "").trim();
                const omschrijving =
                  omschrijvingVolledig.length > 40
                    ? `${omschrijvingVolledig.slice(0, 40).trimEnd()}...`
                    : (omschrijvingVolledig || "—");
                const werkadresParts = [
                  [b?.werk_straat, b?.werk_huisnummer, b?.werk_toevoeging].filter(Boolean).join(" "),
                  b?.werk_postcode,
                  b?.werk_plaats,
                ].filter(Boolean);
                const werkadres = werkadresParts.length ? werkadresParts.join(", ") : "—";
                const isGeplandStatus = statusNorm === "gepland" || statusNorm === "ingepland";
                const isEigenBon = b?.medewerker_id === medewerker?.id;
                const showOnderwegKnop = isGeplandStatus && !b?.onderweg_start && isEigenBon;
                const showBeginWerkKnop = isGeplandStatus && !!b?.onderweg_start && !b?.werkzaamheden_start && isEigenBon;
                const onderwegBusy = onderwegBusyId === b?.id;
                const beginWerkBusy = beginWerkBusyId === b?.id;
                return (
                  <div
                    key={bonId}
                    style={{
                      width: "100%",
                      marginTop: 8,
                      borderRadius: 12,
                      boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                      ...bonStyleByStatus(status),
                      padding: 0,
                      overflow: "hidden",
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "stretch",
                      gap: 0,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => bonId && b?.id && setSelectedBonId(b.id)}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: "left",
                        padding: 10,
                        paddingLeft: 16,
                        border: "none",
                        background: "transparent",
                        color: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                        <span style={{ fontWeight: "normal", fontSize: 13 }}>{b?.werkbonnummer ?? "—"}</span>
                        {b?.label ? <LabelBadge label={b.label} /> : null}
                        {categorieNaam ? (
                          <span style={{ fontSize: 11, opacity: 0.9, padding: "2px 6px", borderRadius: 6, background: "rgba(0,0,0,0.15)" }}>{categorieNaam}</span>
                        ) : null}
                        {isUitvoerder && planningModus === "totaal" ? (
                          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 6, background: isEigenBon ? THEME.brand : "rgba(255,255,255,0.15)", color: isEigenBon ? "#fff" : "var(--app-text)", fontWeight: 500 }}>
                            {b?.medewerker?.naam ?? "Niet toegewezen"}
                          </span>
                        ) : null}
                      </div>
                      <div style={{ fontWeight: "normal", fontSize: 14 }}>{werkadres}</div>
                      <div style={{ marginTop: 4, fontSize: 13 }}>{omschrijving}</div>
                      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>{blok}</div>
                    </button>
                    {showOnderwegKnop ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOnderwegFromList(b);
                        }}
                        disabled={onderwegBusy}
                        style={{
                          padding: "8px 10px",
                          border: "none",
                          borderLeft: `2px solid ${THEME.border}`,
                          background: ACTION_BUTTON_RED,
                          color: "white",
                          fontWeight: 400,
                          fontSize: 12,
                          cursor: onderwegBusy ? "not-allowed" : "pointer",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {onderwegBusy ? "…" : "🚗 Onderweg"}
                      </button>
                    ) : null}
                    {showBeginWerkKnop ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBeginWerkzaamhedenFromList(b);
                        }}
                        disabled={beginWerkBusy}
                        style={{
                          padding: "8px 10px",
                          border: "none",
                          borderLeft: `2px solid ${THEME.border}`,
                          background: ACTION_BUTTON_RED,
                          color: "white",
                          fontWeight: 400,
                          fontSize: 12,
                          cursor: beginWerkBusy ? "not-allowed" : "pointer",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {beginWerkBusy ? "…" : "🔧 Start"}
                      </button>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        ))}
      </div>

      {/* Mobiele fullscreen modal — via portal buiten scroll-container (iOS position:fixed fix) */}
      {selectedBonId ? createPortal(
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: 'var(--app-panel)',
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            touchAction: "pan-y",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: 12,
              paddingLeft: 18,
              paddingTop: "max(12px, env(safe-area-inset-top))",
              borderBottom: `1px solid ${THEME.border}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              background: THEME.brandSoft,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                <span style={{ fontWeight: "normal", fontSize: 16 }}>{selectedBon?.werkbonnummer ?? "—"}</span>
                {selectedBon?.label ? <LabelBadge label={selectedBon.label} /> : null}
              </div>
              <div style={{ fontWeight: "normal", fontSize: 15 }}>
                {[
                  [selectedBon?.werk_straat, selectedBon?.werk_huisnummer, selectedBon?.werk_toevoeging].filter(Boolean).join(" "),
                  selectedBon?.werk_postcode,
                  selectedBon?.werk_plaats,
                ].filter(Boolean).join(", ") || "—"}
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{selectedBon?.interne_referentie || "—"}</div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>{selectedBon?.planblok || "—"}</div>

              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={openHistorie}
                  disabled={modalBusy || uploadBusy}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 12,
                    border: `1px solid ${THEME.border}`,
                    background: 'var(--app-panel)',
                    fontWeight: "normal",
                  }}
                >
                  Historie op dit adres
                </button>

                <button
                  type="button"
                  onClick={openEerdereBonnen}
                  disabled={modalBusy || uploadBusy}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 12,
                    border: `1px solid ${THEME.border}`,
                    background: 'var(--app-panel)',
                    fontWeight: "normal",
                  }}
                >
                  Toon voorgaande bon(nen)
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSelectedBonId(null)}
              disabled={modalBusy || uploadBusy}
              style={{
                fontSize: 18,
                lineHeight: "18px",
                padding: "10px 12px",
                borderRadius: 12,
                border: `1px solid ${THEME.border}`,
                background: 'var(--app-panel)',
                fontWeight: "normal",
              }}
            >
              ✕
            </button>
          </div>

          {/* Body: alleen verticale scroll, lijstweergave zonder horizontaal schuiven */}
          <div style={{ padding: 12, overflowX: "hidden", overflowY: "auto", flex: 1, touchAction: "pan-y", WebkitOverflowScrolling: "touch", minWidth: 0, maxWidth: "100%" }}>
            {/* Tijdsregistratie (bovenin, overzichtelijk) */}
            <div
              style={{
                marginBottom: 16,
                padding: 12,
                borderRadius: 12,
                border: `2px solid ${THEME.border}`,
                background: 'var(--app-panel)',
              }}
            >
              <div style={{ fontWeight: "normal", marginBottom: 8, fontSize: 13 }}>Tijdsregistratie</div>
              {!selectedBon?.onderweg_start ? (
                <button
                  type="button"
                  onClick={handleOnderwegNaarKlant}
                  disabled={!canEdit || modalBusy}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: `1px solid ${ACTION_BUTTON_RED_BORDER}`,
                    background: ACTION_BUTTON_RED,
                    color: "white",
                    fontWeight: 400,
                    fontSize: 13,
                  }}
                >
                  🚗 Onderweg naar klant
                </button>
              ) : !selectedBon?.werkzaamheden_start ? (
                <button
                  type="button"
                  onClick={handleBeginWerkzaamheden}
                  disabled={!canEdit || modalBusy}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: `1px solid ${ACTION_BUTTON_RED_BORDER}`,
                    background: ACTION_BUTTON_RED,
                    color: "white",
                    fontWeight: 400,
                    fontSize: 13,
                  }}
                >
                  🔧 Begin werkzaamheden
                </button>
              ) : !selectedBon?.werkzaamheden_eind ? (
                <div style={{ opacity: 0.9, fontSize: 14 }}>
                  Werkzaamheden gestart. Vul de bon in en klik onderaan op <strong>Einde werkzaamheden</strong>.
                </div>
              ) : (
                <div style={{ opacity: 0.9, fontSize: 14 }}>
                  {magArbeidsloonAutomatischToevoegen(selectedBon)
                    ? `✓ Afgerond • ${selectedBon.werkuren_minuten ?? 0} min facturabel (afgerond)`
                    : '✓ Afgerond'}
                </div>
              )}
              {selectedBon?.onderweg_start && (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                  Onderweg: {formatDateNL(selectedBon.onderweg_start)} {new Date(selectedBon.onderweg_start).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
                </div>
              )}
              {selectedBon?.werkzaamheden_start && (
                <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>
                  Werk gestart: {formatDateNL(selectedBon.werkzaamheden_start)} {new Date(selectedBon.werkzaamheden_start).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
                </div>
              )}
            </div>

            {/* Interne referentie (admin-deel read-only) + aanvulling door buitendienst */}
            <div style={{ fontWeight: "normal" }}>Interne referentie (binnendienst/admin – read-only)</div>
            <div style={{ marginTop: 6, padding: 10, borderRadius: 12, border: `1px solid ${THEME.border}`, background: "#fff", color: "#000", minHeight: 40, whiteSpace: "pre-wrap" }}>
              {selectedBon?.interne_referentie || "—"}
            </div>
            <div style={{ fontWeight: "normal", marginTop: 12 }}>Aanvulling door buitendienst</div>
            <textarea
              value={form.interne_referentie_buitendienst}
              onChange={(e) => setForm((f) => ({ ...f, interne_referentie_buitendienst: e.target.value }))}
              disabled={!canEdit || modalBusy || uploadBusy}
              placeholder="Optioneel: aanvulling op de interne referentie"
              style={{ width: "100%", minHeight: 70, marginTop: 6, borderRadius: 12, border: `1px solid ${THEME.border}`, padding: 10, background: "#fff", color: "#000" }}
            />

            {/* Werkomschrijving (read-only) */}
            <div style={{ fontWeight: "normal", marginTop: 12 }}>Werkomschrijving (read-only)</div>
            <div style={{ marginTop: 6, padding: 10, borderRadius: 12, border: `1px solid ${THEME.border}`, background: "#fff", color: "#000", minHeight: 60, whiteSpace: "pre-wrap" }}>
              {selectedBon?.werkomschrijving || "—"}
            </div>

            <hr style={{ margin: "12px 0" }} />

            {/* Invulvelden */}
            <div style={{ opacity: canEdit ? 1 : 0.5 }}>
              <div style={{ fontWeight: "normal" }}>Bevindingen</div>
              <textarea
                value={form.bevindingen}
                onChange={(e) => setForm((f) => ({ ...f, bevindingen: e.target.value }))}
                disabled={!canEdit || modalBusy || uploadBusy}
                style={{ width: "100%", minHeight: 110, marginTop: 6, borderRadius: 12, border: `1px solid ${THEME.border}`, padding: 10, background: "#fff", color: "#000" }}
              />

              <div style={{ fontWeight: "normal", marginTop: 12 }}>Advies</div>
              <textarea
                value={form.advies}
                onChange={(e) => setForm((f) => ({ ...f, advies: e.target.value }))}
                disabled={!canEdit || modalBusy || uploadBusy}
                style={{ width: "100%", minHeight: 110, marginTop: 6, borderRadius: 12, border: `1px solid ${THEME.border}`, padding: 10, background: "#fff", color: "#000" }}
              />

              <div style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={!!form.klus_gereed}
                    onChange={(e) => setForm((f) => ({ ...f, klus_gereed: e.target.checked }))}
                    disabled={!canEdit || modalBusy || uploadBusy}
                  />
                  Klus gereed
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={!!form.vervolg_nodig}
                    onChange={(e) => setForm((f) => ({ ...f, vervolg_nodig: e.target.checked }))}
                    disabled={!canEdit || modalBusy || uploadBusy}
                  />
                  Vervolgwerk noodzakelijk
                </label>
              </div>

              {magTweedeManArbeidsloonKiezen(selectedBon) ? (
                <div style={{ marginTop: 10 }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={!!form.arbeidsloon_tweede_man}
                      onChange={(e) => setForm((f) => ({ ...f, arbeidsloon_tweede_man: e.target.checked }))}
                      disabled={!canEdit || modalBusy || uploadBusy}
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      <span style={{ display: "block" }}>2e man toevoegen</span>
                      <span style={{ display: "block", fontSize: 12, opacity: 0.85, fontWeight: "normal", marginTop: 2 }}>
                        Verdubbelt alleen het automatische arbeidsloon (urenregel ×2). Voorrijkosten en brandstof blijven 1×.
                      </span>
                    </span>
                  </label>
                </div>
              ) : null}

              <hr style={{ margin: "12px 0" }} />

              {/* MATERIALEN */}
              <div style={{ fontWeight: "normal" }}>Materialen</div>
              {artikelenErr ? <div style={{ marginTop: 6, color: "red" }}>Artikelen laden mislukt: {artikelenErr}</div> : null}

              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 12, opacity: 0.85 }}>
                  Zoek een artikel en pas het aantal aan op de regel. Handmatige regels worden bewaard bij Einde werkzaamheden.
                </div>
                <ArtikelSearchAdd
                  artikelen={artikelen}
                  onAdd={addHandmatigMateriaal}
                  readOnly={!canEdit || modalBusy || uploadBusy}
                  variant="buitendienst"
                  title={null}
                  helpText={null}
                />
              </div>

              {safeArray(form.materialen).length === 0 ? (
                <div style={{ marginTop: 8, opacity: 0.7 }}>— geen materialen —</div>
              ) : (
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {safeArray(form.materialen).map((m, idx) => {
                    const isAutoLocked = isAutoLockedMateriaalRow(m, selectedBon, artikelen ?? [], brandstofSettings)
                    return (
                      <div
                        key={`${m.artikel_id || "x"}-${idx}`}
                        style={{
                          border: `1px solid ${THEME.border}`,
                          borderRadius: 12,
                          padding: 10,
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          background: "#fff",
                          color: "#000",
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: "normal", color: "#000" }}>{m.naam || "—"}</div>
                          <div style={{ fontSize: 12, opacity: 0.8, color: "#000", marginTop: 4, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                            {isAutoLocked ? (
                              <span>Aantal: {m.qty ?? 1}</span>
                            ) : (
                              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span>Aantal:</span>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={m.qty ?? 1}
                                  onChange={(e) => updateMateriaalAantal(idx, e.target.value)}
                                  onBlur={(e) => commitMateriaalAantal(idx, e.target.value)}
                                  disabled={!canEdit || modalBusy || uploadBusy}
                                  style={{
                                    width: 72,
                                    padding: "4px 8px",
                                    borderRadius: 8,
                                    border: `1px solid ${THEME.border}`,
                                    background: "#fff",
                                    color: "#000",
                                  }}
                                />
                              </label>
                            )}
                            {m.artikelnummer != null ? <span>Nr: {m.artikelnummer}</span> : null}
                            {m.eenheid ? <span>{m.eenheid}</span> : null}
                            {isAutoLocked ? <span>• Automatisch</span> : null}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeMateriaal(idx)}
                          disabled={isAutoLocked || !canEdit || modalBusy || uploadBusy}
                          title={isAutoLocked ? "Automatisch toegevoegd; niet handmatig verwijderbaar in buitendienst." : ""}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 12,
                            border: `1px solid ${THEME.border}`,
                            background: 'var(--app-panel)',
                            fontWeight: "normal",
                            opacity: isAutoLocked ? 0.6 : 1,
                            cursor: isAutoLocked ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Verwijder
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Opsomming materialen: totalen + som prijzen */}
              {safeArray(form.materialen).length > 0 ? (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 12,
                    border: `1px solid ${THEME.border}`,
                    background: 'var(--app-panel)',
                  }}
                >
                  <div style={{ fontWeight: "normal", marginBottom: 8 }}>Opsomming materialen</div>
                  {safeArray(form.materialen).map((m, idx) => {
                    const qty = parseMateriaalAantal(m.qty);
                    const prijs = Number(m.prijs) || 0;
                    const regelTotaal = qty * prijs;
                    return (
                      <div
                        key={`ops-${m.artikel_id || "x"}-${idx}`}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                          gap: 8,
                          marginBottom: 4,
                          fontSize: 14,
                        }}
                      >
                        <span>
                          {m.naam || "—"} × {qty}
                          {m.eenheid ? ` ${m.eenheid}` : ""}
                        </span>
                        <span>
                          {prijs > 0 ? `€ ${(regelTotaal).toFixed(2)}` : "—"}
                        </span>
                      </div>
                    );
                  })}
                  <div
                    style={{
                      marginTop: 8,
                      paddingTop: 8,
                      borderTop: `1px solid ${THEME.border}`,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      fontWeight: "normal",
                    }}
                  >
                    <span>Totaal</span>
                    <span>
                      € {safeArray(form.materialen)
                        .reduce((sum, m) => sum + (parseMateriaalAantal(m.qty) * (Number(m.prijs) || 0)), 0)
                        .toFixed(2)}
                    </span>
                  </div>
                </div>
              ) : null}

              <hr style={{ margin: "12px 0" }} />

              {/* FOTO'S */}
              <div style={{ fontWeight: "normal" }}>Foto’s</div>

              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {Capacitor.isNativePlatform() ? (
                  <>
                    <button
                      type="button"
                      disabled={!canEdit || modalBusy || uploadBusy}
                      onClick={() => takeFotoNative(CameraSource.Camera)}
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "10px 14px", borderRadius: 12,
                        border: `1px solid ${canEdit ? THEME.brand : THEME.border}`,
                        background: canEdit && !modalBusy && !uploadBusy ? THEME.brand : "var(--app-panel)",
                        color: canEdit && !modalBusy && !uploadBusy ? "white" : "var(--app-muted)",
                        fontWeight: "normal", fontSize: 14, fontFamily: "inherit", cursor: "pointer",
                      }}
                    >📷 Maak foto</button>
                    <button
                      type="button"
                      disabled={!canEdit || modalBusy || uploadBusy}
                      onClick={() => takeFotoNative(CameraSource.Photos)}
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "10px 14px", borderRadius: 12,
                        border: `1px solid ${THEME.border}`,
                        background: "var(--app-panel)",
                        color: canEdit ? "var(--app-text)" : "var(--app-muted)",
                        fontWeight: "normal", fontSize: 14, fontFamily: "inherit", cursor: "pointer",
                      }}
                    >🖼 Bibliotheek</button>
                  </>
                ) : (
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={!canEdit || modalBusy || uploadBusy}
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      e.target.value = "";
                      if (files.length) uploadFilesToBucket(files);
                    }}
                  />
                )}
              </div>

              {uploadBusy ? <div style={{ marginTop: 6 }}>Uploaden...</div> : null}
              {uploadErr ? <div style={{ marginTop: 6, color: "red" }}>{uploadErr}</div> : null}

              {safeArray(form.fotos_urls).length === 0 ? (
                <div style={{ marginTop: 8, opacity: 0.7 }}>— geen foto’s —</div>
              ) : (
                <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                  {safeArray(form.fotos_urls).map((url, idx) => (
                    <div
                      key={`${url}-${idx}`}
                      style={{
                        border: `1px solid ${THEME.border}`,
                        borderRadius: 12,
                        overflow: "hidden",
                        position: "relative",
                        background: 'var(--app-panel)',
                      }}
                    >
                      <img src={url} alt="foto" style={{ width: "100%", height: 140, objectFit: "cover" }} />
                      <button
                        type="button"
                        onClick={() => removeFoto(idx)}
                        disabled={!canEdit || modalBusy || uploadBusy}
                        style={{
                          position: "absolute",
                          top: 6,
                          right: 6,
                          background: 'var(--app-panel)',
                          border: `1px solid ${THEME.border}`,
                          borderRadius: 10,
                          padding: "6px 8px",
                          fontWeight: "normal",
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!canEdit ? (
              <div style={{ marginTop: 12, color: "#a00" }}>
                Je mag deze werkbon niet bewerken (niet jouw naam of niet status “gepland”).
              </div>
            ) : null}

            {modalError ? <div style={{ color: "red", marginTop: 12 }}>{modalError}</div> : null}
          </div>

          {/* Optioneel: handtekening achter knop (alleen tonen ná "Einde werkzaamheden") */}
          {canEdit && selectedBon?.werkzaamheden_start && selectedBon?.werkzaamheden_eind ? (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: `1px solid ${THEME.border}`, background: 'var(--app-panel)' }}>

              {/* 2e man — ook bereikbaar ná Einde werkzaamheden, zonder omhoog scrollen */}
              {magTweedeManArbeidsloonKiezen(selectedBon) ? (
                <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={!!form.arbeidsloon_tweede_man}
                    onChange={(e) => setForm((f) => ({ ...f, arbeidsloon_tweede_man: e.target.checked }))}
                    disabled={modalBusy || uploadBusy}
                    style={{ marginTop: 3, width: 18, height: 18, accentColor: THEME.brand, flexShrink: 0 }}
                  />
                  <span>
                    <span style={{ display: "block", fontSize: 14 }}>2e man toevoegen</span>
                    <span style={{ display: "block", fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                      Verdubbelt het automatische arbeidsloon (urenregel ×2).
                    </span>
                  </span>
                </label>
              ) : null}

              {!showHandtekeningVeld ? (
                <button
                  type="button"
                  onClick={() => setShowHandtekeningVeld(true)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: `1px solid ${THEME.border}`,
                    background: 'var(--app-panel)',
                    fontWeight: 400,
                    fontSize: 13,
                  }}
                >
                  Klant heeft bon gelezen – handtekening toevoegen
                </button>
              ) : (
                <>
                  <div style={{ fontWeight: "normal", marginBottom: 8, fontSize: 14 }}>Handtekening klant (optioneel)</div>
                  <canvas
                ref={handtekeningCanvasRef}
                width={300}
                height={120}
                style={{ display: "block", border: `1px solid ${THEME.border}`, borderRadius: 8, background: "#fff", touchAction: "none" }}
                onMouseDown={(e) => {
                  const ctx = handtekeningCanvasRef.current?.getContext("2d");
                  if (!ctx) return;
                  ctx.strokeStyle = "#000";
                  ctx.lineWidth = 2;
                  ctx.lineCap = "round";
                  const rect = e.currentTarget.getBoundingClientRect();
                  ctx.beginPath();
                  ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
                  const move = (ev) => {
                    ctx.lineTo(ev.clientX - rect.left, ev.clientY - rect.top);
                    ctx.stroke();
                  };
                  const up = () => {
                    window.removeEventListener("mousemove", move);
                    window.removeEventListener("mouseup", up);
                    setHandtekeningDataUrl(handtekeningCanvasRef.current?.toDataURL("image/png") ?? "");
                  };
                  window.addEventListener("mousemove", move);
                  window.addEventListener("mouseup", up);
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  const ctx = handtekeningCanvasRef.current?.getContext("2d");
                  if (!ctx) return;
                  ctx.strokeStyle = "#000";
                  ctx.lineWidth = 2;
                  ctx.lineCap = "round";
                  const t = e.touches[0];
                  const rect = e.currentTarget.getBoundingClientRect();
                  ctx.beginPath();
                  ctx.moveTo(t.clientX - rect.left, t.clientY - rect.top);
                  const move = (ev) => {
                    const tt = ev.touches[0];
                    ctx.lineTo(tt.clientX - rect.left, tt.clientY - rect.top);
                    ctx.stroke();
                  };
                  const end = () => {
                    e.currentTarget.removeEventListener("touchmove", move);
                    e.currentTarget.removeEventListener("touchend", end);
                    setHandtekeningDataUrl(handtekeningCanvasRef.current?.toDataURL("image/png") ?? "");
                  };
                  e.currentTarget.addEventListener("touchmove", move, { passive: false });
                  e.currentTarget.addEventListener("touchend", end);
                }}
              />
                  <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>Teken hier. Wordt opgeslagen bij &quot;Klaar&quot;.</div>
                </>
              )}
            </div>
          ) : null}

          {/* Footer (sticky) */}
          <div style={{ borderTop: `1px solid ${THEME.border}`, padding: 12, paddingBottom: "calc(12px + env(safe-area-inset-bottom))", display: "flex", gap: 8, flexWrap: "wrap", background: 'var(--app-panel)' }}>
            {/* Verplaats naar mij — uitvoerder in totaal-modus, voor een bon van iemand anders */}
            {isUitvoerder && planningModus === "totaal" && selectedBon?.medewerker_id !== medewerker?.id ? (
              <button
                type="button"
                onClick={handleVerplaatsNaarMij}
                disabled={modalBusy}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px solid ${THEME.brand}`,
                  background: THEME.brand,
                  color: "white",
                  fontWeight: 500,
                  fontSize: 13,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  marginBottom: 4,
                }}
              >
                📋 Verplaats naar mijn planning
              </button>
            ) : null}
            {selectedBon?.werkzaamheden_start && !selectedBon?.werkzaamheden_eind ? (
              <button
                type="button"
                onClick={handleEindeWerkzaamheden}
                disabled={!canEdit || modalBusy || uploadBusy}
                style={{
                  flex: 1,
                  minWidth: 140,
                  padding: 12,
                  borderRadius: 12,
                  border: `2px solid ${THEME.brand}`,
                  background: THEME.brand,
                  color: "white",
                  fontWeight: "normal",
                }}
              >
                {modalBusy ? "Bezig..." : "Einde werkzaamheden"}
              </button>
            ) : null}

            <button
              type="button"
              onClick={handleKlaar}
              disabled={!canEdit || modalBusy || uploadBusy || !selectedBon?.werkzaamheden_eind || (!form.klus_gereed && !form.vervolg_nodig)}
              style={{
                flex: 1,
                minWidth: 100,
                padding: 12,
                borderRadius: 12,
                border: `1px solid ${THEME.brand}`,
                background: THEME.brand,
                color: "white",
                fontWeight: "normal",
              }}
              title={
                !selectedBon?.werkzaamheden_eind
                  ? "Eerst op 'Einde werkzaamheden' klikken (uren verplicht)"
                  : !form.klus_gereed && !form.vervolg_nodig
                    ? "Vink minimaal 'Klus gereed' of 'Vervolgwerk noodzakelijk' aan"
                    : undefined
              }
            >
              {modalBusy || uploadBusy ? "Bezig..." : "Klaar"}
            </button>
          </div>
        </div>
      , document.body) : null}

      </div>
      {renderBottomNav()}
    </div>
  );
}

// ── Instellingen helper componenten ──────────────────────────────────────────

function SettingsGroup({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        padding: "8px 4px",
        fontSize: 11,
        fontWeight: "normal",
        opacity: 0.45,
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        color: "var(--app-text)",
      }}>
        {label}
      </div>
      <div style={{
        borderRadius: 14,
        border: "1px solid var(--app-border, rgba(151,170,196,0.14))",
        background: "var(--app-panel, rgba(13,28,53,0.95))",
        overflow: "hidden",
      }}>
        {children}
      </div>
    </div>
  )
}

function SettingsToggleRow({ label, sublabel, value, onChange }) {
  return (
    <div style={{
      padding: "14px 16px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12,
      borderBottom: "1px solid var(--app-border, rgba(151,170,196,0.08))",
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, color: "var(--app-text)", fontWeight: "normal" }}>{label}</div>
        {sublabel && <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>{sublabel}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        style={{
          position: "relative",
          width: 44,
          height: 26,
          borderRadius: 13,
          border: "none",
          background: value ? "#2b89ff" : "rgba(100,116,139,0.3)",
          cursor: "pointer",
          transition: "background 200ms ease",
          flexShrink: 0,
          padding: 0,
        }}
      >
        <span style={{
          position: "absolute",
          top: 3,
          left: value ? 21 : 3,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "white",
          transition: "left 200ms ease",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }} />
      </button>
    </div>
  )
}

function SettingsSelectRow({ label, sublabel, value, options, onChange }) {
  return (
    <div style={{
      padding: "14px 16px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12,
      borderBottom: "1px solid var(--app-border, rgba(151,170,196,0.08))",
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, color: "var(--app-text)", fontWeight: "normal" }}>{label}</div>
        {sublabel && <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>{sublabel}</div>}
      </div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid var(--app-border, rgba(151,170,196,0.2))",
          background: "var(--app-bg, #0a1628)",
          color: "var(--app-text, rgba(226,232,240,0.95))",
          fontSize: 13,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}
