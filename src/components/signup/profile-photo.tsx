"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient, uploadToBucket } from "@/lib/supabase/client";
import { Spinner, Alert, PersonIcon } from "@/components/ui";

/**
 * Signup step 4 — an OPTIONAL profile photo.
 *
 * ── Why this step exists ──────────────────────────────────────────────────
 * A buyer with no picture used to be represented by their initials on a green
 * disc, which looked like a deliberate avatar and gave nobody a reason to add
 * a real one. Asking once, at the moment the account is created, is the only
 * point where the buyer is already thinking about their profile — and it is
 * the difference between a marketplace of faces and a marketplace of "DA".
 *
 * ── Why it is skippable ───────────────────────────────────────────────────
 * A photo is not required to buy anything, and a signup that cannot be
 * finished without one loses accounts at the last screen. "Skip for now" is a
 * first-class button, not a small link: it goes straight on to the storefront,
 * and the same upload is available later from Profile (see AvatarEditor).
 *
 * ── Why the upload happens here and not on submit ─────────────────────────
 * The account already exists and the buyer is already signed in by the time
 * this screen renders (verifySignupAction mints the session). So the photo is
 * written to `profiles.avatar_url` the moment it is chosen, and "Continue"
 * only navigates. A buyer who uploads and then closes the tab still keeps the
 * photo, and there is no half-saved state to recover from.
 */
export function ProfilePhoto({ next }: { next: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  async function pick(file: File) {
    setErr("");
    setBusy(true);
    try {
      const publicUrl = await uploadToBucket(file, "avatars");
      const supabase = createClient();
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Your session expired. Sign in again to add a photo.");
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", u.user.id);
      if (error) throw new Error(error.message);
      setUrl(publicUrl);
      setSaved(true);
    } catch (e: any) {
      setErr(e?.message ?? "That photo could not be uploaded. Try another one.");
    }
    setBusy(false);
  }

  function go() {
    router.push(next);
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-[430px]">
      {/* step rail — same shape as the details screen, with the new step last */}
      <div className="mb-5 flex items-center gap-2 text-[12px] font-semibold text-ink-400">
        <span className="flex items-center gap-1.5 text-brand-600">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-[11px] text-white">1</span>
          Role
        </span>
        <span className="h-px w-4 bg-slate-200" />
        <span className="flex items-center gap-1.5 text-brand-600">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-[11px] text-white">2</span>
          Details
        </span>
        <span className="h-px w-4 bg-slate-200" />
        <span className="flex items-center gap-1.5 text-brand-600">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-[11px] text-white">3</span>
          Verify
        </span>
        <span className="h-px w-4 bg-slate-200" />
        <span className="flex items-center gap-1.5 text-brand-600">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-[11px] text-white">4</span>
          Photo
        </span>
      </div>

      <h1 className="text-[25px] font-extrabold tracking-tight text-ink-900">Add a profile photo</h1>
      <p className="mt-1 text-[13.5px] leading-relaxed text-ink-500">
        Sellers and buyers see this next to your name in chats, reviews and orders. It is{" "}
        <strong className="text-ink-700">optional</strong> — you can skip it and add one later from your profile.
      </p>

      <div className="mt-6 flex flex-col items-center">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label={url ? "Change your profile photo" : "Choose a profile photo"}
          className="group relative grid h-32 w-32 place-items-center overflow-hidden rounded-full border-2 border-dashed border-[var(--line)] bg-slate-50 text-ink-400 transition hover:border-brand-400 hover:bg-brand-50/40 disabled:opacity-70"
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Your profile photo" className="h-full w-full object-cover" />
          ) : busy ? (
            <Spinner className="!h-6 !w-6" />
          ) : (
            <PersonIcon size={54} />
          )}

          {busy && url && (
            <span className="absolute inset-0 grid place-items-center bg-black/40 text-white">
              <Spinner className="!h-6 !w-6" />
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-3 text-[13px] font-semibold text-brand-700 underline disabled:opacity-60"
        >
          {url ? "Choose a different photo" : "Upload a photo"}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pick(f);
            e.target.value = "";
          }}
        />

        <p className="mt-2 max-w-[300px] text-center text-[11.5px] leading-relaxed text-ink-400">
          A clear photo of your face works best. JPEG, PNG or WebP.
        </p>
      </div>

      {err && (
        <div className="mt-4">
          <Alert tone="red">{err}</Alert>
        </div>
      )}
      {saved && !err && (
        <div className="mt-4">
          <Alert tone="green">Photo saved. You can change it any time from your profile.</Alert>
        </div>
      )}

      <div className="mt-6 space-y-2">
        <button type="button" onClick={go} disabled={busy} className="nm-btn-primary w-full !py-3">
          {url ? "Continue" : "Continue without a photo"}
        </button>

        {/* Skipping is a real choice, so it is a full-width button rather than
            a small link that looks like an afterthought. */}
        <button
          type="button"
          onClick={go}
          disabled={busy}
          className="nm-btn-ghost w-full !py-3"
        >
          Skip for now
        </button>
      </div>

      <p className="mt-4 text-center text-[12.5px] text-ink-500">
        You can add or change this later in{" "}
        <Link href="/profile" className="font-semibold text-brand-600 hover:underline">
          your profile
        </Link>
        .
      </p>
    </div>
  );
}
