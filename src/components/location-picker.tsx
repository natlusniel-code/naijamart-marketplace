"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { NIGERIA_STATES, lgasFor } from "@/lib/utils";
import { Spinner, Alert } from "@/components/ui";

export function LocationPicker({ initial }: { initial: { state: string; city: string } }) {
  const router = useRouter();
  const [state, setState] = useState(initial.state);
  const [city, setCity] = useState(initial.city);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const lg = lgasFor(state);

  async function save() {
    setBusy(true);
    setErr("");
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("profiles").update({ state, city }).eq("id", u.user!.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="nm-label" htmlFor="st">State</label>
        <select id="st" className="nm-input" value={state}
          onChange={(e) => { setState(e.target.value); setCity(lgasFor(e.target.value)[0] ?? city); }}>
          {NIGERIA_STATES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <label className="nm-label" htmlFor="ct">City / LGA</label>
        <select id="ct" className="nm-input" value={city} onChange={(e) => setCity(e.target.value)}>
          {(lg.length ? lg : [city]).filter(Boolean).map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      {err && <Alert tone="red">{err}</Alert>}
      <button onClick={save} disabled={busy} className="nm-btn-primary w-full !py-3">
        {busy ? <><Spinner /> Saving…</> : `Set my city to ${city}`}
      </button>
    </div>
  );
}
