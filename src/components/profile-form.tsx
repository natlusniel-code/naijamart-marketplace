"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, uploadToBucket } from "@/lib/supabase/client";
import { NIGERIA_STATES, lgasFor } from "@/lib/utils";
import { Avatar, Spinner, Alert, Card } from "@/components/ui";

export function AvatarEditor({ avatarUrl, name }: { avatarUrl: string | null; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(avatarUrl);
  const [err, setErr] = useState("");

  async function pick(file: File) {
    setBusy(true);
    setErr("");
    try {
      const publicUrl = await uploadToBucket(file, "avatars");
      const supabase = createClient();
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("id", u.user!.id);
      if (error) throw new Error(error.message);
      setUrl(publicUrl);
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  }

  return (
    <div className="relative">
      <Avatar name={name} src={url} size={64} />
      <label className="absolute -bottom-1 -right-1 grid h-6 w-6 cursor-pointer place-items-center rounded-full border-2 border-white bg-brand-500 text-white shadow-sm hover:bg-brand-600">
        {busy ? (
          <Spinner className="!h-3 !w-3" />
        ) : (
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.4}>
            <path d="M4 8h3l1.5-2h7L17 8h3v11H4V8Z" />
            <circle cx="12" cy="13" r="3" />
          </svg>
        )}
        <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      </label>
      {err && <p className="absolute left-0 top-16 w-40 text-[10px] text-red-600">{err}</p>}
    </div>
  );
}

export function ProfileForm({
  initial,
}: {
  initial: { full_name: string; phone: string; state: string; city: string };
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState("");
  const lg = lgasFor(form.state);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        state: form.state,
        city: form.city,
      })
      .eq("id", u.user!.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOk(true);
    router.refresh();
  }

  return (
    <Card className="p-4">
      <p className="text-[14px] font-bold text-ink-900">Your details</p>
      <form onSubmit={save} className="mt-2.5 space-y-2.5">
        <div>
          <label className="nm-label" htmlFor="fn">Full name</label>
          <input id="fn" className="nm-input" value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
        </div>
        <div>
          <label className="nm-label" htmlFor="ph">Phone number</label>
          <input id="ph" className="nm-input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="08012345678" />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="nm-label" htmlFor="st">State</label>
            <select id="st" className="nm-input" value={form.state}
              onChange={(e) => setForm((f) => ({ ...f, state: e.target.value, city: lgasFor(e.target.value)[0] ?? f.city }))}>
              {NIGERIA_STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="nm-label" htmlFor="ct">City / LGA</label>
            <select id="ct" className="nm-input" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}>
              {(lg.length ? lg : [form.city]).filter(Boolean).map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <p className="text-[11.5px] leading-relaxed text-ink-400">
          Your city decides which sellers you can order from. You can browse anywhere.
        </p>
        {err && <Alert tone="red">{err}</Alert>}
        {ok && !err && <Alert tone="green">Saved.</Alert>}
        <button type="submit" disabled={busy} className="nm-btn-primary w-full !py-2.5">
          {busy ? <><Spinner /> Saving…</> : "Save details"}
        </button>
      </form>
    </Card>
  );
}
