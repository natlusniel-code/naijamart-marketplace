"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner, Alert, Badge } from "@/components/ui";
import { PRODUCT_FRAME_FIT } from "@/lib/image-frame";
import {
  ACCEPTED_TYPES,
  BANNER_HEIGHT,
  BANNER_WIDTH,
  MAX_FILE_BYTES,
  AiListingError,
  bannerPreviewUrl,
  copyText,
  generateListing,
  listingToText,
  prepareImage,
  regenerateField,
  type GeneratedListing,
  type PreparedImage,
  type RegenerateField,
} from "@/lib/ai-listing";

/**
 * The "✨ Generate with AI" panel that sits at the top of the listing form.
 *
 * ── Why it is a panel and not a page ──────────────────────────────────────
 * The seller is already in the form with a category, a price and a stock
 * count typed in. Sending them to a separate page to write the copy would
 * mean losing that, so the panel writes straight into the form's own title,
 * description and tags fields and never navigates.
 *
 * ── Draft persistence ─────────────────────────────────────────────────────
 * A generated listing is a minute of waiting and a paid API call, so losing
 * it to an accidental refresh is unacceptable. The result is mirrored into
 * `localStorage` under a key scoped to the shop (and the listing, when
 * editing) and restored on mount. It is cleared when the seller applies it
 * or dismisses the panel, so a stale draft never surprises them later.
 *
 * ── Mobile ────────────────────────────────────────────────────────────────
 * Every row is a single column below `sm`; the banner grid is one column on
 * a phone and two from `sm` up. The banner frames keep a fixed 1200×630
 * ratio at every width, so the six prompts always look like the six banners
 * they describe.
 */

const DRAFT_VERSION = 1;

type Draft = {
  v: number;
  listing: GeneratedListing;
  notes: string;
  thumb: string | null;
};

function draftKey(shopId: string, listingId?: string) {
  return `nm:ai-listing:${shopId}:${listingId ?? "new"}`;
}

export function AiListingPanel({
  shopId,
  listingId,
  onApply,
}: {
  shopId: string;
  listingId?: string;
  /** Write the generated copy into the form's own fields. */
  onApply: (v: { title: string; description: string; tags: string[] }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<PreparedImage | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<GeneratedListing | null>(null);
  const [regenBusy, setRegenBusy] = useState<string>("");
  const [applied, setApplied] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const key = useMemo(() => draftKey(shopId, listingId), [shopId, listingId]);

  /* ---------------------------------------------------------- restore */

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const d = JSON.parse(raw) as Draft;
      if (d?.v !== DRAFT_VERSION || !d.listing) return;
      setResult(d.listing);
      setNotes(d.notes ?? "");
      setOpen(true);
    } catch {
      /* a corrupt draft is not worth an error message */
    }
  }, [key]);

  /* ------------------------------------------------------------ save */

  useEffect(() => {
    if (!result) return;
    try {
      const d: Draft = {
        v: DRAFT_VERSION,
        listing: result,
        notes,
        thumb: prepared?.dataUrl ?? null,
      };
      localStorage.setItem(key, JSON.stringify(d));
    } catch {
      /* quota or private mode — the in-memory result still works */
    }
  }, [result, notes, prepared, key]);

  /* --------------------------------------------------------- cleanup */

  useEffect(() => () => abortRef.current?.abort(), []);

  /* ----------------------------------------------------------- pick */

  const pickFile = useCallback(async (f: File) => {
    setErr("");
    setNotice("");
    setApplied(false);
    if (!ACCEPTED_TYPES.includes(f.type as (typeof ACCEPTED_TYPES)[number])) {
      setErr("That file type is not supported. Use a JPEG, PNG or WebP photo.");
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setErr(
        `That photo is ${(f.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB — try a smaller one.`,
      );
      return;
    }
    setFile(f);
    setPrepared(null);
    try {
      const p = await prepareImage(f);
      setPrepared(p);
      if (p.bytes < f.size) {
        setNotice(
          `Resized to ${p.width}×${p.height} (${Math.round(p.bytes / 1024)} KB) so the upload stays fast.`,
        );
      }
    } catch (e: any) {
      setErr(e?.message ?? "That photo could not be read. Try another one.");
      setFile(null);
    }
  }, []);

  /* ------------------------------------------------------- generate */

  async function generate() {
    if (!prepared) {
      setErr("Choose a product photo first.");
      return;
    }
    setErr("");
    setNotice("");
    setApplied(false);
    setBusy(true);
    setSlow(false);

    // A real photo upload can take 10–20 s. After 20 s the bare spinner
    // starts to look broken, so the copy changes to say what is happening.
    const slowTimer = setTimeout(() => setSlow(true), 20_000);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const listing = await generateListing({
        base64: prepared.base64,
        mimeType: prepared.mimeType,
        notes,
        signal: controller.signal,
      });
      setResult(listing);
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setNotice("Cancelled.");
      } else if (e instanceof AiListingError) {
        setErr(e.message);
      } else {
        setErr("Could not reach the AI service. Check your connection and retry.");
      }
    } finally {
      clearTimeout(slowTimer);
      setBusy(false);
      setSlow(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  /* ----------------------------------------------------- regenerate */

  async function regen(field: RegenerateField, bannerType?: string) {
    if (!prepared || !result) return;
    const tag = bannerType ? `banner:${bannerType}` : field;
    setRegenBusy(tag);
    setErr("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const value = await regenerateField({
        field,
        bannerType,
        base64: prepared.base64,
        mimeType: prepared.mimeType,
        notes,
        context: result,
        signal: controller.signal,
      });
      setResult((r) => {
        if (!r) return r;
        if (field === "tags") return { ...r, tags: value as string[] };
        if (field === "banner") {
          return {
            ...r,
            bannerPrompts: r.bannerPrompts.map((b) =>
              b.type === bannerType ? { ...b, prompt: value as string } : b,
            ),
          };
        }
        return { ...r, [field]: value as string };
      });
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setErr(e instanceof AiListingError ? e.message : "Could not regenerate that field. Please try again.");
      }
    } finally {
      setRegenBusy("");
      abortRef.current = null;
    }
  }

  /* ---------------------------------------------------------- apply */

  function apply() {
    if (!result) return;
    onApply({
      title: result.title,
      description: [result.shortDescription, result.longDescription].filter(Boolean).join("\n\n"),
      tags: result.tags,
    });
    setApplied(true);
    setNotice("Filled into the form below. Edit anything you like before publishing.");
  }

  function discard() {
    setResult(null);
    setFile(null);
    setPrepared(null);
    setNotes("");
    setErr("");
    setNotice("");
    setApplied(false);
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  /* ----------------------------------------------------------- view */

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-2xl border border-brand-500/25 bg-gradient-to-r from-brand-50 to-white px-4 py-3.5 text-left transition hover:border-brand-500/50 hover:shadow-card"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500 text-[16px] text-white shadow-sm">
          ✨
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold text-ink-900">Generate with AI</span>
          <span className="mt-0.5 block text-[12px] leading-snug text-ink-500">
            Upload a photo — we write the title, description, tags and six banner prompts.
          </span>
        </span>
        <span className="shrink-0 text-[13px] font-semibold text-brand-700">Open</span>
      </button>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-brand-500/25 bg-white shadow-card">
      {/* header */}
      <div className="flex items-center gap-2.5 border-b border-[var(--line)] bg-gradient-to-r from-brand-50 to-white px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-500 text-[14px] text-white">
          ✨
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-ink-900">Generate with AI</p>
          <p className="text-[11.5px] text-ink-500">Photo in, listing copy out.</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Minimise the AI panel"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-400 hover:bg-slate-100 hover:text-ink-700"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
            <path d="M5 12h14" />
          </svg>
        </button>
      </div>

      <div className="space-y-3 p-4">
        {/* upload */}
        <div>
          <label className="nm-label">Product photo</label>

          {prepared ? (
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={prepared.dataUrl}
                alt="Selected product"
                className={`h-20 w-20 shrink-0 rounded-xl border border-[var(--line)] ${PRODUCT_FRAME_FIT}`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold text-ink-900">{file?.name}</p>
                <p className="mt-0.5 text-[11.5px] text-ink-500">
                  {prepared.width}×{prepared.height} · {Math.round(prepared.bytes / 1024)} KB
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-1.5 text-[12px] font-semibold text-brand-700 underline"
                >
                  Choose a different photo
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--line)] bg-slate-50/60 px-4 py-7 text-center transition hover:border-brand-400 hover:bg-brand-50/40"
            >
              <span className="text-[22px]">📷</span>
              <span className="text-[13px] font-semibold text-ink-900">Tap to choose a photo</span>
              <span className="text-[11.5px] text-ink-400">JPEG, PNG or WebP · up to 5 MB</span>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickFile(f);
              e.target.value = "";
            }}
          />
        </div>

        {/* notes */}
        <div>
          <label className="nm-label" htmlFor="ai-notes">
            Notes <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <input
            id="ai-notes"
            className="nm-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. rattan, 30cm, handmade"
            maxLength={300}
          />
          <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
            Anything the photo cannot show — material, size, how it is made.
          </p>
        </div>

        {err && <Alert tone="red">{err}</Alert>}
        {notice && !err && <Alert tone="green">{notice}</Alert>}

        {/* actions */}
        <div className="flex gap-2">
          {busy ? (
            <>
              <button type="button" disabled className="nm-btn-primary flex-1 !py-3">
                <Spinner /> {slow ? "Still analysing…" : "Analysing your product…"}
              </button>
              <button type="button" onClick={cancel} className="nm-btn-ghost !px-4 !py-3">
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={generate}
              disabled={!prepared}
              className="nm-btn-primary flex-1 !py-3"
            >
              {result ? "Generate again" : "Generate listing"}
            </button>
          )}
        </div>

        {busy && slow && (
          <p className="text-center text-[11.5px] leading-relaxed text-ink-400">
            Big photos take a little longer. This usually finishes within 30 seconds.
          </p>
        )}

        {/* results */}
        {result && (
          <div className="space-y-3 border-t border-[var(--line)] pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] font-bold text-ink-900">Your listing</p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await copyText(listingToText(result));
                    setNotice(ok ? "Whole listing copied." : "Could not copy — select the text instead.");
                  }}
                  className="nm-btn-ghost !px-2.5 !py-1.5 !text-[12px]"
                >
                  Copy all
                </button>
                <button
                  type="button"
                  onClick={discard}
                  className="nm-btn-ghost !px-2.5 !py-1.5 !text-[12px]"
                >
                  Discard
                </button>
              </div>
            </div>

            {/* title */}
            <Field
              label="Title"
              counter={`${result.title.length}/60`}
              counterWarn={result.title.length > 60}
              onCopy={() => copyText(result.title)}
              onRegen={() => regen("title")}
              regenBusy={regenBusy === "title"}
            >
              <input
                className="nm-input"
                value={result.title}
                maxLength={60}
                onChange={(e) => setResult({ ...result, title: e.target.value })}
              />
            </Field>

            {/* short */}
            <Field
              label="Short description"
              onCopy={() => copyText(result.shortDescription)}
              onRegen={() => regen("shortDescription")}
              regenBusy={regenBusy === "shortDescription"}
            >
              <textarea
                rows={2}
                className="nm-input resize-none"
                value={result.shortDescription}
                onChange={(e) => setResult({ ...result, shortDescription: e.target.value })}
              />
            </Field>

            {/* long */}
            <Field
              label="Long description"
              onCopy={() => copyText(result.longDescription)}
              onRegen={() => regen("longDescription")}
              regenBusy={regenBusy === "longDescription"}
            >
              <textarea
                rows={7}
                className="nm-input resize-y"
                value={result.longDescription}
                onChange={(e) => setResult({ ...result, longDescription: e.target.value })}
              />
            </Field>

            {/* tags */}
            <Field
              label="Search tags"
              counter={`${result.tags.length}`}
              onCopy={() => copyText(result.tags.join(", "))}
              onRegen={() => regen("tags")}
              regenBusy={regenBusy === "tags"}
            >
              <div className="flex flex-wrap gap-1.5 rounded-xl border border-[var(--line)] bg-white p-2">
                {result.tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[11.5px] font-semibold text-brand-800"
                  >
                    {t}
                    <button
                      type="button"
                      aria-label={`Remove tag ${t}`}
                      onClick={() => setResult({ ...result, tags: result.tags.filter((x) => x !== t) })}
                      className="grid h-3.5 w-3.5 place-items-center rounded-full bg-brand-200/70 text-[9px] leading-none text-brand-900 hover:bg-brand-300"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {result.tags.length === 0 && (
                  <span className="px-1 py-0.5 text-[12px] text-ink-400">No tags — regenerate to get some.</span>
                )}
              </div>
            </Field>

            {/* banners */}
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label className="nm-label !mb-0">Banner prompts</label>
                <Badge tone="gray">{BANNER_WIDTH}×{BANNER_HEIGHT}</Badge>
              </div>
              <p className="mb-2 text-[11px] leading-relaxed text-ink-400">
                All six are the same horizontal frame, so they line up as a set.
              </p>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {result.bannerPrompts.map((b) => {
                  const tag = `banner:${b.type}`;
                  return (
                    <div
                      key={b.type}
                      className="overflow-hidden rounded-xl border border-[var(--line)] bg-white"
                    >
                      {/* The frame itself: fixed 1200×630 ratio at any width,
                          so the six cards read as six banners. */}
                      <div
                        className="relative w-full bg-gradient-to-br from-slate-100 to-slate-50"
                        style={{ aspectRatio: `${BANNER_WIDTH} / ${BANNER_HEIGHT}` }}
                      >
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
                            {b.type}
                          </span>
                          <span className="text-[10.5px] text-ink-400">
                            {BANNER_WIDTH} × {BANNER_HEIGHT} · 1.91:1
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1.5 p-2.5">
                        <textarea
                          rows={4}
                          className="nm-input !px-2.5 !py-2 !text-[12px] resize-y"
                          value={b.prompt}
                          placeholder="No prompt for this banner — regenerate it."
                          onChange={(e) =>
                            setResult({
                              ...result,
                              bannerPrompts: result.bannerPrompts.map((x) =>
                                x.type === b.type ? { ...x, prompt: e.target.value } : x,
                              ),
                            })
                          }
                        />
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => copyText(b.prompt)}
                            className="nm-btn-ghost !px-2 !py-1 !text-[11px]"
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            onClick={() => regen("banner", b.type)}
                            disabled={!!regenBusy}
                            className="nm-btn-ghost !px-2 !py-1 !text-[11px]"
                          >
                            {regenBusy === tag ? <Spinner className="h-3 w-3" /> : "Regenerate"}
                          </button>
                          <a
                            href={bannerPreviewUrl(b.prompt || b.type)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="nm-btn-ghost !px-2 !py-1 !text-[11px]"
                          >
                            Preview banner
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <button type="button" onClick={apply} className="nm-btn-primary w-full !py-3">
              {applied ? "✓ Filled into the form" : "Use this in my listing"}
            </button>
            <p className="text-center text-[11px] leading-relaxed text-ink-400">
              Fills the title, description and tags below. Nothing is published until you press Publish.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Field */

function Field({
  label,
  counter,
  counterWarn,
  onCopy,
  onRegen,
  regenBusy,
  children,
}: {
  label: string;
  counter?: string;
  counterWarn?: boolean;
  onCopy: () => void;
  onRegen: () => void;
  regenBusy: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="nm-label !mb-0">{label}</label>
        <div className="flex items-center gap-1.5">
          {counter && (
            <span
              className={`text-[11px] font-semibold tabular-nums ${
                counterWarn ? "text-red-600" : "text-ink-400"
              }`}
            >
              {counter}
            </span>
          )}
          <button
            type="button"
            onClick={onCopy}
            className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-ink-500 hover:bg-slate-100 hover:text-ink-900"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={onRegen}
            disabled={regenBusy}
            className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50"
          >
            {regenBusy ? <Spinner className="h-3 w-3" /> : "Regenerate"}
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
