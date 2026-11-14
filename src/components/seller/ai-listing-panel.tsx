"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner, Alert } from "@/components/ui";
import { uploadToBucket } from "@/lib/supabase/client";
import {
  ACCEPTED_TYPES,
  BANNER_SPECS,
  MAX_FILE_BYTES,
  MAX_PHOTOS,
  MIN_TITLE_CHARS,
  AiListingError,
  bannerPromptsToText,
  copyText,
  generateListing,
  listingToText,
  prepareImage,
  regenerateField,
  urlToBase64,
  type GeneratedListing,
  type ListingKind,
  type PreparedImage,
  type RegenerateField,
} from "@/lib/ai-listing";

/**
 * The "✨ Generate with AI" panel at the top of the listing form.
 *
 * ── The flow the seller sees ────────────────────────────────────────────
 *  1. Type a TITLE. That alone is enough. A description is optional; up to
 *     six photos are optional for a service and compulsory for a product.
 *  2. Press "Analyse" — the photos upload to storage while Gemini reads
 *     them, in parallel, so the upload costs no extra waiting.
 *  3. The listing copy appears in editable fields.
 *  4. The six banner art-direction prompts appear, and can be copied all at
 *     once with a single action.
 *
 * ── Why the banner prompts are shown, not rendered ──────────────────────
 * The brief is explicit: Gemini produces the six banner prompts, and the
 * seller takes them away to render elsewhere. They are shown in a copyable
 * block — one "Copy all" action copies all six at once.
 *
 * ── Why `kind` is a prop ────────────────────────────────────────────────
 * A product and a service get different copy and different banner art
 * direction (a product campaign vs a gig flyer), and different input rules
 * (a product needs a photo, a service does not). The panel is the same
 * component for both; `kind` is what makes it behave correctly.
 */

const DRAFT_VERSION = 3;

type Draft = {
  v: number;
  listing: GeneratedListing;
  title: string;
  details: string;
  imageUrls: string[];
};

function draftKey(shopId: string, listingId?: string) {
  return `nm:ai-listing:${shopId}:${listingId ?? "new"}`;
}

export function AiListingPanel({
  shopId,
  listingId,
  kind,
  onApply,
}: {
  shopId: string;
  listingId?: string;
  /** Product or service — decides the prompt shape and the input rules. */
  kind: ListingKind;
  /** Write the generated copy into the form's own fields. */
  onApply: (v: { title: string; description: string; tags: string[] }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<{ file: File; prepared: PreparedImage }[]>([]);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<GeneratedListing | null>(null);
  const [regenBusy, setRegenBusy] = useState<string>("");
  const [applied, setApplied] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const key = useMemo(() => draftKey(shopId, listingId), [shopId, listingId]);

  const isService = kind === "service";
  const titleOk = title.trim().length >= MIN_TITLE_CHARS;
  const photosOk = isService || photos.length > 0;
  const canGenerate = titleOk && photosOk;

  /* ---------------------------------------------------------- restore */

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const d = JSON.parse(raw) as Draft;
      if (d?.v !== DRAFT_VERSION || !d.listing) return;
      setResult(d.listing);
      setTitle(d.title ?? "");
      setDetails(d.details ?? "");
      setImageUrls(d.imageUrls ?? []);
      setOpen(true);
    } catch {
      /* a corrupt draft is not worth an error message */
    }
  }, [key]);

  /* ------------------------------------------------------------ save */

  useEffect(() => {
    if (!result) return;
    try {
      const d: Draft = { v: DRAFT_VERSION, listing: result, title, details, imageUrls };
      localStorage.setItem(key, JSON.stringify(d));
    } catch {
      /* quota or private mode — the in-memory result still works */
    }
  }, [result, title, details, imageUrls, key]);

  /* --------------------------------------------------------- cleanup */

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  /* ----------------------------------------------------------- pick */

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      setErr("");
      setNotice("");
      setApplied(false);

      const incoming = Array.from(files);
      const room = MAX_PHOTOS - photos.length;
      if (room <= 0) {
        setErr(`You can add up to ${MAX_PHOTOS} photos. Remove one to add another.`);
        return;
      }

      const accepted: { file: File; prepared: PreparedImage }[] = [];
      for (const f of incoming.slice(0, room)) {
        if (!ACCEPTED_TYPES.includes(f.type as (typeof ACCEPTED_TYPES)[number])) {
          setErr("That file type is not supported. Use a JPEG, PNG or WebP photo.");
          continue;
        }
        if (f.size > MAX_FILE_BYTES) {
          setErr(
            `"${f.name}" is ${(f.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB per photo.`,
          );
          continue;
        }
        try {
          accepted.push({ file: f, prepared: await prepareImage(f) });
        } catch (e: any) {
          setErr(e?.message ?? "That photo could not be read. Try another one.");
        }
      }

      if (incoming.length > room) {
        setNotice(`Only ${room} more photo${room === 1 ? "" : "s"} could be added (max ${MAX_PHOTOS}).`);
      }
      if (accepted.length) setPhotos((p) => [...p, ...accepted].slice(0, MAX_PHOTOS));
    },
    [photos.length],
  );

  function removePhoto(i: number) {
    setPhotos((p) => p.filter((_, idx) => idx !== i));
    setImageUrls((u) => u.filter((_, idx) => idx !== i));
  }

  /* ------------------------------------------------------- generate */

  async function generate() {
    if (!titleOk) {
      setErr("Add a title first.");
      return;
    }
    if (!photosOk) {
      setErr("Add at least one product photo first.");
      return;
    }

    setErr("");
    setNotice("");
    setApplied(false);
    setBusy(true);
    setSlow(false);

    const slowTimer = setTimeout(() => setSlow(true), 20_000);
    const controller = new AbortController();
    abortRef.current = controller;

    // Upload and analyse in PARALLEL. The upload keeps the photos available
    // for regenerating a field after a refresh. If the upload fails the
    // listing copy is still useful, so the failure is reported but does not
    // abort the analysis.
    setUploading(true);
    const uploadPromise = (async () => {
      const urls: string[] = [];
      for (const p of photos) {
        try {
          urls.push(await uploadToBucket(p.file, `ai-listings/${shopId}`));
        } catch {
          /* handled below */
        }
      }
      return urls;
    })();

    try {
      const listing = await generateListing({
        kind,
        title,
        details,
        images: photos.map((p) => ({ base64: p.prepared.base64, mimeType: p.prepared.mimeType })),
        signal: controller.signal,
      });
      setResult(listing);

      const urls = await uploadPromise;
      setUploading(false);
      setImageUrls(urls);
    } catch (e: any) {
      setUploading(false);
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

  async function regen(field: RegenerateField) {
    if (!result) return;
    setRegenBusy(field);
    setErr("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      // After a refresh the photos are gone from memory but their public
      // URLs survive, so the reference is reloaded from storage.
      const images = photos.length
        ? photos.map((p) => ({ base64: p.prepared.base64, mimeType: p.prepared.mimeType }))
        : await Promise.all(imageUrls.slice(0, MAX_PHOTOS).map((u) => urlToBase64(u)));

      const value = await regenerateField({
        field,
        kind,
        title,
        images,
        details,
        context: result,
        signal: controller.signal,
      });
      setResult((r) => {
        if (!r) return r;
        if (field === "tags") return { ...r, tags: value as string[] };
        return { ...r, [field]: value as string };
      });
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setErr(
          e instanceof AiListingError ? e.message : "Could not regenerate that field. Please try again.",
        );
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
    setPhotos([]);
    setTitle("");
    setDetails("");
    setImageUrls([]);
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
            {isService
              ? "Type a title — we write the gig and design six flyer prompts."
              : "Upload photos — we write the listing and design six banners."}
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
          <p className="text-[11.5px] text-ink-500">
            {isService ? "Title in, gig and flyer prompts out." : "Photos in, listing and banner prompts out."}
          </p>
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
        {/* ── photos ─────────────────────────────────────────────────────── */}
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label className="nm-label !mb-0">
              {isService ? "Service photos" : "Product photos"}{" "}
              {isService ? (
                <span className="font-normal text-ink-400">(optional)</span>
              ) : (
                <span className="text-red-600">(required)</span>
              )}
            </label>
            <span className="text-[11px] font-semibold tabular-nums text-ink-400">
              {photos.length}/{MAX_PHOTOS}
            </span>
          </div>

          {photos.length > 0 && (
            <div className="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {photos.map((p, i) => (
                <div key={i} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.prepared.dataUrl}
                    alt={`Product photo ${i + 1}`}
                    className="aspect-square w-full rounded-xl border border-[var(--line)] object-contain bg-slate-50"
                  />
                  {i === 0 && (
                    <span className="absolute left-1 top-1 rounded-md bg-brand-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                      Main
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    aria-label={`Remove photo ${i + 1}`}
                    className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-[var(--line)] bg-white text-[11px] font-bold leading-none text-ink-600 shadow-sm hover:bg-red-50 hover:text-red-600"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {photos.length < MAX_PHOTOS && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--line)] bg-slate-50/60 px-4 py-6 text-center transition hover:border-brand-400 hover:bg-brand-50/40"
            >
              <span className="text-[20px]">📷</span>
              <span className="text-[13px] font-semibold text-ink-900">
                {photos.length
                  ? "Add more photos"
                  : isService
                    ? "Add a photo of your work (optional)"
                    : "Tap to choose photos"}
              </span>
              <span className="text-[11.5px] text-ink-400">
                JPEG, PNG or WebP · up to 5 MB each · max {MAX_PHOTOS}
              </span>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {/* ── title (compulsory) ─────────────────────────────────────────── */}
        <div>
          <label className="nm-label" htmlFor="ai-title">
            Title <span className="text-red-600">(required)</span>
          </label>
          <input
            id="ai-title"
            className="nm-input"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (err === "Add a title first.") setErr("");
            }}
            placeholder={
              isService
                ? "e.g. Logo design for a new bakery brand"
                : "e.g. Handwoven rattan storage basket"
            }
            maxLength={120}
          />
          <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
            {titleOk
              ? "The AI expands this into the full listing."
              : `Type at least ${MIN_TITLE_CHARS} characters to continue.`}
          </p>
        </div>

        <div>
          <label className="nm-label" htmlFor="ai-details">
            Description <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <textarea
            id="ai-details"
            rows={3}
            className="nm-input resize-y"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder={
              isService
                ? "e.g. Logo creation — three concepts, two revision rounds, delivered in 5 days"
                : "e.g. 30cm, natural finish, handmade in Ghana — anything the photos cannot show"
            }
            maxLength={600}
          />
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <p className="text-[11px] leading-relaxed text-ink-400">
              {isService
                ? "Say what the gig is and what the buyer gets. Optional — the title alone is enough."
                : "The AI uses this as the source of truth for anything the photos cannot show."}
            </p>
            <span className="shrink-0 text-[10.5px] tabular-nums text-ink-400">{details.length}/600</span>
          </div>
        </div>

        {err && <Alert tone="red">{err}</Alert>}
        {notice && !err && <Alert tone="green">{notice}</Alert>}

        {/* ── actions ────────────────────────────────────────────────────── */}
        <div className="flex gap-2">
          {busy ? (
            <>
              <button type="button" disabled className="nm-btn-primary flex-1 !py-3">
                <Spinner />{" "}
                {slow ? "Still analysing…" : isService ? "Writing your gig…" : "Analysing your product…"}
              </button>
              <button type="button" onClick={cancel} className="nm-btn-ghost !px-4 !py-3">
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={generate}
              disabled={!canGenerate}
              className="nm-btn-primary flex-1 !py-3"
            >
              {result ? "Generate again" : isService ? "Generate gig" : "Analyse product"}
            </button>
          )}
        </div>

        {!canGenerate && !busy && (
          <p className="text-center text-[11px] leading-relaxed text-ink-400">
            {!titleOk
              ? "Add a title to continue."
              : isService
                ? "Add a title to continue."
                : "Add at least one product photo to continue."}
          </p>
        )}

        {busy && slow && (
          <p className="text-center text-[11.5px] leading-relaxed text-ink-400">
            Big photos take a little longer. This usually finishes within 30 seconds.
          </p>
        )}

        {/* ── results ────────────────────────────────────────────────────── */}
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
                <button type="button" onClick={discard} className="nm-btn-ghost !px-2.5 !py-1.5 !text-[12px]">
                  Discard
                </button>
              </div>
            </div>

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

            {/* ── banner prompts ─────────────────────────────────────────── */}
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label className="nm-label !mb-0">Banner prompts</label>
                <span className="text-[11px] font-semibold text-ink-400">6 designs</span>
              </div>
              <p className="mb-2 text-[11px] leading-relaxed text-ink-400">
                Gemini wrote six art-direction prompts for your banners. Copy them all at once and
                render them in your image tool of choice.
              </p>

              <button
                type="button"
                onClick={async () => {
                  const ok = await copyText(bannerPromptsToText(result));
                  setNotice(ok ? "All six banner prompts copied." : "Could not copy — select the text instead.");
                }}
                className="nm-btn-primary mb-2 w-full !py-2.5 !text-[13px]"
              >
                Copy all six prompts
              </button>

              <div className="space-y-2">
                {BANNER_SPECS.map((spec) => {
                  const prompt = result.bannerPrompts.find((b) => b.type === spec.type)?.prompt ?? "";
                  return (
                    <div key={spec.type} className="rounded-xl border border-[var(--line)] bg-slate-50/60 p-2.5">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-ink-600">
                          {spec.type}
                        </span>
                        <span className="text-[10px] font-semibold tabular-nums text-ink-400">
                          {spec.width} × {spec.height} · {spec.label}
                        </span>
                      </div>
                      <p className="text-[12px] leading-relaxed text-ink-700">
                        {prompt || "No prompt was generated for this banner."}
                      </p>
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
