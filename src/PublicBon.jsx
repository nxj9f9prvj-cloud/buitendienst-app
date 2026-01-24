// src/PublicBon.jsx
import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";

export default function PublicBon() {
  const { token } = useParams();
  const [bon, setBon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setErr("");

      const { data, error } = await supabase
        .from("werkbonnen")
        .select(
          "werkbonnummer, plandatum, planblok, werkomschrijving, bevindingen, advies, klus_gereed, vervolg_nodig, status, afhandel_status"
        )
        .eq("public_token", token)
        .maybeSingle();

      if (!mounted) return;

      setLoading(false);

      if (error) {
        setErr(error.message);
        setBon(null);
        return;
      }

      if (!data) {
        setErr("Deze link klopt niet (werkbon niet gevonden).");
        setBon(null);
        return;
      }

      setBon(data);
    }

    load();
    return () => {
      mounted = false;
    };
  }, [token]);

  if (loading) return <div style={{ padding: 16 }}>Laden...</div>;

  if (err) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ color: "red" }}>{err}</div>
        <div style={{ marginTop: 12 }}>
          <Link to="/">Terug</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 700, margin: "0 auto" }}>
      <h2 style={{ marginTop: 0 }}>Werkbon {bon.werkbonnummer}</h2>

      <div style={{ opacity: 0.8 }}>
        {bon.plandatum || "—"} • {bon.planblok || "—"}
      </div>

      <div style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
        <div style={{ fontWeight: "bold" }}>Werkomschrijving</div>
        <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{bon.werkomschrijving || "—"}</div>
      </div>

      <div style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
        <div style={{ fontWeight: "bold" }}>Bevindingen</div>
        <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{bon.bevindingen || "—"}</div>
      </div>

      <div style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
        <div style={{ fontWeight: "bold" }}>Advies</div>
        <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{bon.advies || "—"}</div>
      </div>

      <div style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
        <div style={{ fontWeight: "bold" }}>Status</div>
        <div style={{ marginTop: 6 }}>
          Bon status: <b>{bon.status || "—"}</b>
          <br />
          Afhandel status: <b>{bon.afhandel_status || "—"}</b>
          <br />
          Klus gereed: <b>{bon.klus_gereed ? "Ja" : "Nee"}</b>
          <br />
          Vervolgwerk nodig: <b>{bon.vervolg_nodig ? "Ja" : "Nee"}</b>
        </div>
      </div>
    </div>
  );
}
