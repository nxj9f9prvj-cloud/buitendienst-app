// src/App.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "./contexts/AuthContext";
import { supabase } from "./lib/supabaseClient";

// ===== THEME =====
const THEME = {
  brand: "#C1121F", // rood
  brandSoft: "#FFF1F2",
  text: "#111827",
  border: "#E5E7EB",
  bg: "#F8FAFC",
};

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

function calcAfhandelStatus({ klus_gereed, vervolg_nodig }) {
  if (klus_gereed === true && vervolg_nodig === false) return "te_verwerken";
  return "vervolgactie_noodzakelijk";
}

function bonStyleByStatus(status) {
  const s = String(status || "").toLowerCase();

  if (s === "gepland") {
    return {
      border: "1px solid #9bbcff",
      background: "#eaf2ff",
    };
  }

  if (s === "klaar") {
    return {
      border: "1px solid #8fd39a",
      background: "#e9f8ec",
    };
  }

  return {
    border: `1px solid ${THEME.border}`,
    background: "white",
  };
}

// W226/0001 => { prefix:'W', serie:226, rest:'/0001' }
function parseWerkbonnummer(wb) {
  const s = String(wb || "").trim();
  const m = s.match(/^([A-Za-z])(\d{3})(.*)$/);
  if (!m) return null;
  return { prefix: m[1], serie: Number(m[2]), rest: m[3] || "" };
}

// W226/0001 => ["W126/0001","W026/0001"]
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

export default function App() {
  const { user, loading, signIn, signOut } = useAuth();

  // mini-router
  const [page, setPage] = useState("planning"); // planning | alleWerkbonnen
  const [alleBonnenContext, setAlleBonnenContext] = useState(null);

  // login state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginErr, setLoginErr] = useState("");

  // medewerker
  const [medewerker, setMedewerker] = useState(null);
  const [medewerkerErr, setMedewerkerErr] = useState("");

  // views
  const [view, setView] = useState("werkweek"); // vandaag | werkweek | heleweek
  const [weekOffset, setWeekOffset] = useState(0);
  const [dayOffset, setDayOffset] = useState(0);

  // bonnen lijst (planning)
  const [bonnen, setBonnen] = useState([]);
  const [bonnenLoading, setBonnenLoading] = useState(false);
  const [bonnenError, setBonnenError] = useState("");

  // artikelen (dropdown)
  const [artikelen, setArtikelen] = useState([]);
  const [artikelenErr, setArtikelenErr] = useState("");
  const [artikelSearch, setArtikelSearch] = useState("");

  // modal
  const [selectedBonId, setSelectedBonId] = useState(null);
  const [selectedBon, setSelectedBon] = useState(null); // full record
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState("");

  // invulvelden (modal form)
  const [form, setForm] = useState({
    bevindingen: "",
    advies: "",
    klus_gereed: false,
    vervolg_nodig: false,
    fotos_urls: [],
    materialen: [],
  });

  // upload state
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

  // materialen add state
  const [matArtikelId, setMatArtikelId] = useState("");
  const [matAantal, setMatAantal] = useState(1);

  // alle werkbonnen pagina data
  const [alleBonnen, setAlleBonnen] = useState([]);
  const [alleBonnenLoading, setAlleBonnenLoading] = useState(false);
  const [alleBonnenErr, setAlleBonnenErr] = useState("");
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

  // artikelen ophalen
  useEffect(() => {
    if (!user) {
      setArtikelen([]);
      setArtikelenErr("");
      return;
    }

    supabase
      .from("artikelen")
      .select("id, naam, artikelnummer, eenheid, prijs, actief")
      .eq("actief", true)
      .order("naam", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          setArtikelen([]);
          setArtikelenErr(error.message);
          return;
        }
        setArtikelen(data ?? []);
        setArtikelenErr("");
      });
  }, [user]);

  const filteredArtikelen = useMemo(() => {
    const q = String(artikelSearch || "").trim().toLowerCase();
    if (!q) return artikelen;
    return (artikelen || []).filter((a) => {
      const naam = String(a?.naam || "").toLowerCase();
      const nr = String(a?.artikelnummer ?? "").toLowerCase();
      return naam.includes(q) || nr.includes(q);
    });
  }, [artikelen, artikelSearch]);

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

  // bonnen ophalen voor range (gepland + klaar voor deze monteur)
  const fetchBonnen = async () => {
    if (!medewerker) return;

    setBonnenLoading(true);
    setBonnenError("");

    const { data, error } = await supabase
      .from("werkbonnen")
      .select("id, werkbonnummer, plandatum, planblok, werkomschrijving, status, created_at")
      .in("status", ["gepland", "klaar"])
      .eq("medewerker_id", medewerker.id)
      .gte("plandatum", rangeStart)
      .lte("plandatum", rangeEnd)
      .order("plandatum", { ascending: true })
      .order("planblok", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true });

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
  }, [medewerker, rangeStart, rangeEnd]);

  // groeperen per dag
  const grouped = useMemo(() => {
    const map = {};
    for (const d of days) map[d.date] = [];
    for (const b of bonnen) {
      const key = String(b.plandatum || "").slice(0, 10);
      if (!map[key]) map[key] = [];
      map[key].push(b);
    }
    return map;
  }, [bonnen, days]);

  // modal: werkbon volledig ophalen bij open
  useEffect(() => {
    if (!selectedBonId) {
      setSelectedBon(null);
      setModalError("");
      setModalBusy(false);
      setUploadErr("");
      setUploadBusy(false);
      setArtikelSearch("");

      setForm({
        bevindingen: "",
        advies: "",
        klus_gereed: false,
        vervolg_nodig: false,
        fotos_urls: [],
        materialen: [],
      });

      setMatArtikelId("");
      setMatAantal(1);
      return;
    }

    setModalBusy(true);
    setModalError("");
    setUploadErr("");
    setUploadBusy(false);
    setArtikelSearch("");

    supabase
      .from("werkbonnen")
      .select(
        [
          "id",
          "werkbonnummer",
          "plandatum",
          "planblok",
          "werkomschrijving",
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
        ].join(", ")
      )
      .eq("id", selectedBonId)
      .single()
      .then(({ data, error }) => {
        setModalBusy(false);
        if (error) {
          setSelectedBon(null);
          setModalError(error.message);
          return;
        }

        setSelectedBon(data);

        setForm({
          bevindingen: data?.bevindingen ?? "",
          advies: data?.advies ?? "",
          klus_gereed: !!data?.klus_gereed,
          vervolg_nodig: !!data?.vervolg_nodig,
          fotos_urls: safeArray(data?.fotos_urls),
          materialen: safeArray(data?.materialen),
        });
      });
  }, [selectedBonId]);

  // mag bewerken?
  const canEdit = useMemo(() => {
    if (!selectedBon || !medewerker) return false;
    return selectedBon.status === "gepland" && selectedBon.medewerker_id === medewerker.id;
  }, [selectedBon, medewerker]);

  async function uploadFilesToBucket(files) {
    if (!selectedBon) return;

    setUploadBusy(true);
    setUploadErr("");

    const uploadedUrls = [];

    for (const file of files) {
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
      if (data?.publicUrl) uploadedUrls.push(data.publicUrl);
    }

    setForm((f) => ({ ...f, fotos_urls: [...safeArray(f.fotos_urls), ...uploadedUrls] }));
    setUploadBusy(false);
  }
  async function handleSave() {
    if (!selectedBon) return;

    setModalBusy(true);
    setModalError("");

    const payload = {
      bevindingen: form.bevindingen || null,
      advies: form.advies || null,
      klus_gereed: !!form.klus_gereed,
      vervolg_nodig: !!form.vervolg_nodig,
      ingevuld_door: medewerker?.id ?? null,
      ingevuld_op: new Date().toISOString(),
      afhandel_status: calcAfhandelStatus({
        klus_gereed: !!form.klus_gereed,
        vervolg_nodig: !!form.vervolg_nodig,
      }),
      fotos_urls: safeArray(form.fotos_urls),
      materialen: safeArray(form.materialen),
    };

    const { error } = await supabase.from("werkbonnen").update(payload).eq("id", selectedBon.id);

    setModalBusy(false);

    if (error) {
      setModalError(error.message);
      return;
    }

    setSelectedBon((prev) => (prev ? { ...prev, ...payload } : prev));
    await fetchBonnen();
  }

  async function handleKlaar() {
    if (!selectedBon) return;

    setModalBusy(true);
    setModalError("");

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
      klus_gereed: !!form.klus_gereed,
      vervolg_nodig: !!form.vervolg_nodig,
      fotos_urls: safeArray(form.fotos_urls),
      materialen: safeArray(form.materialen),
    };

    const { error } = await supabase.from("werkbonnen").update(payload).eq("id", selectedBon.id);

    setModalBusy(false);

    if (error) {
      setModalError(error.message);
      return;
    }

    setSelectedBonId(null);
    await fetchBonnen();
  }

  // ===== materialen helpers =====
  function addMateriaal() {
    if (!matArtikelId) return;

    const art =
      filteredArtikelen.find((a) => String(a.id) === String(matArtikelId)) ||
      artikelen.find((a) => String(a.id) === String(matArtikelId));

    if (!art) return;

    const aantal = Number(matAantal);
    const qty = Number.isFinite(aantal) && aantal > 0 ? aantal : 1;

    setForm((f) => ({
      ...f,
      materialen: [
        ...safeArray(f.materialen),
        {
          artikel_id: art.id,
          naam: art.naam,
          artikelnummer: art.artikelnummer ?? null,
          eenheid: art.eenheid ?? null,
          prijs: art.prijs ?? null,
          qty,
        },
      ],
    }));

    setMatArtikelId("");
    setMatAantal(1);
    setArtikelSearch("");
  }

  function removeMateriaal(idx) {
    setForm((f) => {
      const list = [...safeArray(f.materialen)];
      list.splice(idx, 1);
      return { ...f, materialen: list };
    });
  }

  function removeFoto(idx) {
    setForm((f) => {
      const list = [...safeArray(f.fotos_urls)];
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

    // 1) historie op adres
    if (ctx.type === "historie_op_adres") {
      const postcode = String(ctx.postcode || "").trim();
      const huisnummer = String(ctx.huisnummer || "").trim();

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
        .neq("id", ctx.bon_id)
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

  // als je naar Alle Werkbonnen gaat: direct laden
  useEffect(() => {
    if (page !== "alleWerkbonnen") return;
    loadAlleBonnen(alleBonnenContext);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, alleBonnenContext]);

  // ===== popup knoppen =====
  function openHistorie() {
    setAlleBonnenContext({
      type: "historie_op_adres",
      bon_id: selectedBon?.id ?? null,
      postcode: selectedBon?.werk_postcode ?? null,
      huisnummer: selectedBon?.werk_huisnummer ?? null,
      werkbonnummer: selectedBon?.werkbonnummer ?? null,
    });
    setPage("alleWerkbonnen");
  }

  function openEerdereBonnen() {
    setAlleBonnenContext({
      type: "eerdere_bonnen",
      bon_id: selectedBon?.id ?? null,
      werkbonnummer: selectedBon?.werkbonnummer ?? null,
      eerdere: buildEerdereBonnen(selectedBon?.werkbonnummer),
    });
    setPage("alleWerkbonnen");
  }

  if (loading) return <div>Loading...</div>;
  // login scherm
  if (!user) {
    return (
      <div style={{ padding: 16, maxWidth: 360 }}>
        <h2>Login</h2>

        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ width: "100%", padding: 10, borderRadius: 10, border: `1px solid ${THEME.border}` }}
        />
        <div style={{ height: 8 }} />
        <input
          type="password"
          placeholder="Wachtwoord"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: "100%", padding: 10, borderRadius: 10, border: `1px solid ${THEME.border}` }}
        />

        {loginErr ? <div style={{ color: "red", marginTop: 8 }}>{loginErr}</div> : null}

        <button
          onClick={async () => {
            setLoginErr("");
            try {
              await signIn(email, password);
            } catch (e) {
              setLoginErr(e.message);
            }
          }}
          style={{
            marginTop: 12,
            width: "100%",
            padding: 12,
            borderRadius: 12,
            border: `1px solid ${THEME.brand}`,
            background: THEME.brand,
            color: "white",
            fontWeight: "bold",
          }}
        >
          Inloggen
        </button>
      </div>
    );
  }

  // ===== Alle Werkbonnen pagina =====
  if (page === "alleWerkbonnen") {
    const title =
      alleBonnenContext?.type === "historie_op_adres"
        ? "Historie (zelfde adres)"
        : alleBonnenContext?.type === "eerdere_bonnen"
        ? "Eerdere bonnen"
        : "Alle Werkbonnen";

    return (
      <div style={{ padding: 16, background: THEME.bg, minHeight: "100vh" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              setPage("planning");
              setAlleBonnenContext(null);
            }}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: `1px solid ${THEME.border}`,
              background: "white",
              fontWeight: "bold",
            }}
          >
            ← Terug
          </button>
          <div style={{ fontWeight: "bold", color: THEME.text }}>{title}</div>
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
              onClick={() => {
                setPage("planning");
                setSelectedBonId(b.id);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                border: `1px solid ${THEME.border}`,
                padding: 10,
                marginTop: 8,
                background: "white",
                borderRadius: 12,
                boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: "bold" }}>{b.werkbonnummer}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{b.plandatum || "—"}</div>
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
      </div>
    );
  }

  // ===== planning scherm =====
  return (
    <div style={{ padding: 16, background: THEME.bg, minHeight: "100vh" }}>
      {/* Header card */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          padding: 12,
          border: `1px solid ${THEME.border}`,
          borderRadius: 14,
          background: "white",
          boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img
            src="/logo.png"
            alt="Logo"
            style={{ width: 36, height: 36, borderRadius: 8, objectFit: "contain" }}
          />
          <div>
            <div style={{ fontWeight: "bold", color: THEME.brand }}>Buitendienst</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Ingelogd als: {user.email} ({medewerker?.naam || "—"})
            </div>
          </div>
        </div>

        <button
          onClick={signOut}
          style={{
            marginLeft: "auto",
            padding: "10px 12px",
            borderRadius: 12,
            border: `1px solid ${THEME.brand}`,
            background: THEME.brand,
            color: "white",
            fontWeight: "bold",
          }}
        >
          Uitloggen
        </button>
      </div>

      {medewerkerErr ? <div style={{ color: "red", marginTop: 8 }}>{medewerkerErr}</div> : null}

      {/* View knoppen */}
      <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => {
            setView("vandaag");
            setDayOffset(0);
          }}
          style={{
            fontWeight: view === "vandaag" ? "bold" : "normal",
            padding: "10px 12px",
            borderRadius: 12,
            border: `1px solid ${THEME.border}`,
            background: "white",
          }}
        >
          Vandaag
        </button>

        <button
          onClick={() => setView("werkweek")}
          style={{
            fontWeight: view === "werkweek" ? "bold" : "normal",
            padding: "10px 12px",
            borderRadius: 12,
            border: `1px solid ${THEME.border}`,
            background: "white",
          }}
        >
          Werkweek
        </button>

        <button
          onClick={() => setView("heleweek")}
          style={{
            fontWeight: view === "heleweek" ? "bold" : "normal",
            padding: "10px 12px",
            borderRadius: 12,
            border: `1px solid ${THEME.border}`,
            background: "white",
          }}
        >
          Hele week
        </button>
      </div>

      {/* Navigatie */}
      {view === "vandaag" ? (
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => setDayOffset((x) => x - 1)}
            style={{ padding: "10px 12px", borderRadius: 12, border: `1px solid ${THEME.border}`, background: "white" }}
          >
            ← gisteren
          </button>
          <div>Datum: {rangeStart}</div>
          <button
            onClick={() => setDayOffset((x) => x + 1)}
            style={{ padding: "10px 12px", borderRadius: 12, border: `1px solid ${THEME.border}`, background: "white" }}
          >
            morgen →
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            style={{ padding: "10px 12px", borderRadius: 12, border: `1px solid ${THEME.border}`, background: "white" }}
          >
            ← vorige week
          </button>
          <div>
            Range: {rangeStart} t/m {rangeEnd}
          </div>
          <button
            onClick={() => setWeekOffset((w) => w + 1)}
            style={{ padding: "10px 12px", borderRadius: 12, border: `1px solid ${THEME.border}`, background: "white" }}
          >
            volgende week →
          </button>
        </div>
      )}

      {bonnenLoading ? <div style={{ marginTop: 12 }}>Laden...</div> : null}
      {bonnenError ? <div style={{ marginTop: 12, color: "red" }}>{bonnenError}</div> : null}

      <div style={{ marginTop: 16 }}>
        {days.map((d) => (
          <div key={d.date} style={{ marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>
              {d.label} ({d.date})
            </h3>

            {(grouped[d.date] ?? []).length === 0 ? (
              <div style={{ marginTop: 6 }}>— geen werkbonnen —</div>
            ) : (
              (grouped[d.date] ?? []).map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelectedBonId(b.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: 10,
                    marginTop: 8,
                    borderRadius: 12,
                    boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                    ...bonStyleByStatus(b.status),
                  }}
                >
                  <div>
                    <b>{b.werkbonnummer}</b> – {b.planblok || "—"}
                    <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
                      Status: {b.status === "gepland" ? "Ingepland" : b.status === "klaar" ? "Klaar" : b.status}
                    </div>
                  </div>
                  <div style={{ marginTop: 4 }}>{b.werkomschrijving || "—"}</div>
                </button>
              ))
            )}
          </div>
        ))}
      </div>

      {/* Mobiele fullscreen modal */}
      {selectedBonId ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "white",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: 12,
              borderBottom: `1px solid ${THEME.border}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              background: THEME.brandSoft,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: "bold", color: THEME.brand }}>{selectedBon?.werkbonnummer || "..."}</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                {selectedBon?.plandatum || "—"} • {selectedBon?.planblok || "—"}
              </div>

              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                {selectedBon?.werk_straat || ""} {selectedBon?.werk_huisnummer || ""} {selectedBon?.werk_toevoeging || ""},{" "}
                {selectedBon?.werk_postcode || ""} {selectedBon?.werk_plaats || ""}
              </div>

              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={openHistorie}
                  disabled={modalBusy || uploadBusy}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 12,
                    border: `1px solid ${THEME.border}`,
                    background: "white",
                    fontWeight: "bold",
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
                    background: "white",
                    fontWeight: "bold",
                  }}
                >
                  Toon eerdere bon(nen)
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
                background: "white",
                fontWeight: "bold",
              }}
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: 12, overflowY: "auto", flex: 1 }}>
            {/* Read-only */}
            <div style={{ fontWeight: "bold" }}>Werkomschrijving (read-only)</div>
            <div style={{ marginTop: 6 }}>{selectedBon?.werkomschrijving || "—"}</div>

            <hr style={{ margin: "12px 0" }} />

            {/* Invulvelden */}
            <div style={{ opacity: canEdit ? 1 : 0.5 }}>
              <div style={{ fontWeight: "bold" }}>Bevindingen</div>
              <textarea
                value={form.bevindingen}
                onChange={(e) => setForm((f) => ({ ...f, bevindingen: e.target.value }))}
                disabled={!canEdit || modalBusy || uploadBusy}
                style={{ width: "100%", minHeight: 110, marginTop: 6, borderRadius: 12, border: `1px solid ${THEME.border}`, padding: 10 }}
              />

              <div style={{ fontWeight: "bold", marginTop: 12 }}>Advies</div>
              <textarea
                value={form.advies}
                onChange={(e) => setForm((f) => ({ ...f, advies: e.target.value }))}
                disabled={!canEdit || modalBusy || uploadBusy}
                style={{ width: "100%", minHeight: 110, marginTop: 6, borderRadius: 12, border: `1px solid ${THEME.border}`, padding: 10 }}
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

              <hr style={{ margin: "12px 0" }} />

              {/* MATERIALEN */}
              <div style={{ fontWeight: "bold" }}>Materialen</div>
              {artikelenErr ? <div style={{ marginTop: 6, color: "red" }}>Artikelen laden mislukt: {artikelenErr}</div> : null}

              <div style={{ marginTop: 8 }}>
                <input
                  placeholder="Zoek materiaal (naam of artikelnummer)"
                  value={artikelSearch}
                  onChange={(e) => setArtikelSearch(e.target.value)}
                  disabled={!canEdit || modalBusy || uploadBusy}
                  style={{ width: "100%", padding: 10, borderRadius: 12, border: `1px solid ${THEME.border}` }}
                />
              </div>

              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  value={matArtikelId}
                  onChange={(e) => setMatArtikelId(e.target.value)}
                  disabled={!canEdit || modalBusy || uploadBusy}
                  style={{ flex: 1, minWidth: 220, padding: 10, borderRadius: 12, border: `1px solid ${THEME.border}` }}
                >
                  <option value="">
                    {artikelSearch ? `Kies uit ${filteredArtikelen.length} resultaat/resultaten…` : "Kies artikel…"}
                  </option>
                  {filteredArtikelen.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.naam} {a.artikelnummer != null ? `(${a.artikelnummer})` : ""}
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  min="1"
                  value={matAantal}
                  onChange={(e) => setMatAantal(e.target.value)}
                  disabled={!canEdit || modalBusy || uploadBusy}
                  style={{ width: 90, padding: 10, borderRadius: 12, border: `1px solid ${THEME.border}` }}
                />

                <button
                  type="button"
                  onClick={addMateriaal}
                  disabled={!canEdit || !matArtikelId || modalBusy || uploadBusy}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: `1px solid ${THEME.brand}`,
                    background: THEME.brand,
                    color: "white",
                    fontWeight: "bold",
                  }}
                >
                  + Toevoegen
                </button>
              </div>

              {safeArray(form.materialen).length === 0 ? (
                <div style={{ marginTop: 8, opacity: 0.7 }}>— geen materialen —</div>
              ) : (
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {safeArray(form.materialen).map((m, idx) => (
                    <div
                      key={`${m.artikel_id || "x"}-${idx}`}
                      style={{
                        border: `1px solid ${THEME.border}`,
                        borderRadius: 12,
                        padding: 10,
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        background: "white",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: "bold" }}>{m.naam || "—"}</div>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>
                          Aantal: {m.qty ?? 1}
                          {m.artikelnummer != null ? ` • Nr: ${m.artikelnummer}` : ""}
                          {m.eenheid ? ` • ${m.eenheid}` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeMateriaal(idx)}
                        disabled={!canEdit || modalBusy || uploadBusy}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 12,
                          border: `1px solid ${THEME.border}`,
                          background: "white",
                          fontWeight: "bold",
                        }}
                      >
                        Verwijder
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <hr style={{ margin: "12px 0" }} />

              {/* FOTO'S */}
              <div style={{ fontWeight: "bold" }}>Foto’s</div>

              <div style={{ marginTop: 8 }}>
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
                        background: "white",
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
                          background: "white",
                          border: `1px solid ${THEME.border}`,
                          borderRadius: 10,
                          padding: "6px 8px",
                          fontWeight: "bold",
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

          {/* Footer (sticky) */}
          <div style={{ borderTop: `1px solid ${THEME.border}`, padding: 12, display: "flex", gap: 8, background: "white" }}>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canEdit || modalBusy || uploadBusy}
              style={{
                flex: 1,
                padding: 12,
                borderRadius: 12,
                border: `1px solid ${THEME.border}`,
                background: "white",
                fontWeight: "bold",
              }}
            >
              {modalBusy || uploadBusy ? "Bezig..." : "Opslaan"}
            </button>

            <button
              type="button"
              onClick={handleKlaar}
              disabled={!canEdit || modalBusy || uploadBusy}
              style={{
                flex: 1,
                padding: 12,
                borderRadius: 12,
                border: `1px solid ${THEME.brand}`,
                background: THEME.brand,
                color: "white",
                fontWeight: "bold",
              }}
            >
              {modalBusy || uploadBusy ? "Bezig..." : "Klaar"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
