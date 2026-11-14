"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ListingCard } from "@/components/cards";
import { Spinner } from "@/components/ui";
import { cn, naira } from "@/lib/utils";
import type { Listing } from "@/lib/queries";

/**
 * AI voice and image search.
 *
 * ── How it stays fast ────────────────────────────────────────────────────
 *   VOICE  the Web Speech API transcribes in the browser, so the words
 *          appear as the buyer speaks and the search fires the moment they
 *          stop. No audio is uploaded. The server only interprets the
 *          transcript, which is a ~1 s call.
 *   IMAGE  the photo is downscaled to 1024px in a canvas before it is
 *          posted, so the request body is ~150 KB instead of 6 MB. The
 *          server names the product and runs the normal search.
 *
 * ── Why the interpretation is shown ──────────────────────────────────────
 * "Searching for: black leather sandals" tells the buyer what the AI
 * understood, so a wrong guess is visible and correctable rather than
 * mysterious. It is also the honest thing to do: the buyer can see the
 * query that produced the results.
 *
 * ── Why there is a text fallback everywhere ──────────────────────────────
 * The Web Speech API is not in every browser (Firefox has no support). When
 * it is missing the mic button is disabled with a reason, and the buyer can
 * still type. A feature that silently does nothing is worse than one that
 * says why.
 */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

export function AiSearchBar({ initialQuery = "" }: { initialQuery?: string }) {
  const [text, setText] = useState(initialQuery);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [interpretation, setInterpretation] = useState("");
  const [results, setResults] = useState<Listing[] | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [speechSupported, setSpeechSupported] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Feature-detect the Web Speech API once, on the client.
  useEffect(() => {
    const w = window as any;
    setSpeechSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  /** Run a search and render the results. */
  const run = useCallback(async (payload: Record<string, unknown>) => {
    setBusy(true);
    setErr("");
    setInterpretation("");
    setResults(null);

    try {
      const res = await fetch("/api/ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!data.ok) {
        setErr(data.error ?? "Search failed.");
        setBusy(false);
        return;
      }

      setInterpretation(data.interpretation ?? "");
      setResults(Array.isArray(data.listings) ? data.listings : []);
      setLatency(typeof data.latencyMs === "number" ? data.latencyMs : null);
    } catch {
      setErr("Could not reach search. Check your connection.");
    }
    setBusy(false);
  }, []);

  /* ── Voice ──────────────────────────────────────────────────────────── */

  function startVoice() {
    const w = window as any;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      setErr("Voice search is not supported in this browser. Type your search instead.");
      return;
    }

    setErr("");
    const rec: SpeechRecognitionLike = new Ctor();
    rec.lang = "en-NG";
    rec.continuous = false;
    rec.interimResults = true;

    rec.onresult = (e: any) => {
      let transcript = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      setText(transcript);
      // Fire as soon as the browser marks the phrase final — waiting for
      // `onend` adds a noticeable pause after the buyer stops talking.
      if (e.results[e.results.length - 1]?.isFinal) {
        rec.stop();
        run({ modality: "voice", text: transcript.trim() });
      }
    };

    rec.onerror = (e: any) => {
      setListening(false);
      if (e?.error === "not-allowed") {
        setErr("Microphone access was blocked. Allow it in your browser settings and try again.");
      } else if (e?.error === "no-speech") {
        setErr("I did not hear anything. Try again.");
      } else {
        setErr("Voice search failed. Type your search instead.");
      }
    };

    rec.onend = () => setListening(false);

    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  function stopVoice() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  /* ── Image ──────────────────────────────────────────────────────────── */

  async function onFile(file: File) {
    setErr("");
    if (!file.type.startsWith("image/")) {
      setErr("Choose a photo.");
      return;
    }

    setBusy(true);
    try {
      const { base64, mimeType } = await downscale(file);
      await run({ modality: "image", base64, mimeType });
    } catch {
      setErr("That photo could not be read. Try another one.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* ── The bar ─────────────────────────────────────────────────── */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) run({ modality: "text", text: text.trim() });
        }}
        className="flex items-center gap-1.5"
      >
        <div className="relative flex-1">
          <svg
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={listening ? "Listening…" : "Search, speak, or use a photo"}
            className="nm-input !py-3 pl-10 pr-10"
            aria-label="Search query"
          />
          {text && (
            <button
              type="button"
              onClick={() => {
                setText("");
                setResults(null);
                setInterpretation("");
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
              aria-label="Clear"
            >
              ✕
            </button>
          )}
        </div>

        {/* Mic */}
        <button
          type="button"
          onClick={listening ? stopVoice : startVoice}
          disabled={busy || !speechSupported}
          title={
            speechSupported
              ? listening
                ? "Stop listening"
                : "Search by voice"
              : "Voice search is not supported in this browser"
          }
          className={cn(
            "grid h-[46px] w-[46px] shrink-0 place-items-center rounded-xl border transition",
            listening
              ? "border-red-300 bg-red-50 text-red-600"
              : "border-[var(--line)] bg-white text-ink-600 hover:border-brand-300 hover:text-brand-700",
            (!speechSupported || busy) && "opacity-40",
          )}
          aria-label="Search by voice"
        >
          {listening ? (
            <span className="relative flex h-4 w-4">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
              <span className="relative inline-flex h-4 w-4 rounded-full bg-red-500" />
            </span>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          )}
        </button>

        {/* Camera */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="Search by photo"
          className={cn(
            "grid h-[46px] w-[46px] shrink-0 place-items-center rounded-xl border border-[var(--line)] bg-white text-ink-600 transition hover:border-brand-300 hover:text-brand-700",
            busy && "opacity-40",
          )}
          aria-label="Search by photo"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.2-1.6A1 1 0 0 1 9.2 4h5.6a1 1 0 0 1 .8.4L16.8 6h1.7A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5Z" />
            <circle cx="12" cy="13" r="3.4" />
          </svg>
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </form>

      {/* ── Status ──────────────────────────────────────────────────── */}
      {listening && (
        <p className="text-[12px] font-medium text-red-600">Listening… speak now.</p>
      )}

      {busy && (
        <p className="flex items-center gap-2 text-[12px] text-ink-500">
          <Spinner /> Searching…
        </p>
      )}

      {err && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">{err}</p>
      )}

      {interpretation && !busy && (
        <p className="text-[12px] text-ink-500">
          {interpretation}
          {latency != null && (
            <span className="ml-1.5 text-[10.5px] text-ink-400">· {latency} ms</span>
          )}
        </p>
      )}

      {/* ── Results ─────────────────────────────────────────────────── */}
      {results && !busy && (
        <div>
          {results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-6 text-center">
              <p className="text-[13px] font-semibold text-ink-800">Nothing matched</p>
              <p className="mt-0.5 text-[12px] text-ink-500">
                Try different words, or{" "}
                <Link href="/search" className="font-semibold text-brand-600 underline">
                  browse everything
                </Link>
                .
              </p>
            </div>
          ) : (
            <>
              <p className="mb-2 text-[11.5px] font-semibold text-ink-500">
                {results.length} result{results.length === 1 ? "" : "s"}
              </p>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {results.slice(0, 12).map((l) => (
                  <ListingCard key={l.id} l={l} signedIn />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Downscale a photo to 1024px on its longest edge and return base64.
 *
 * This is what keeps image search fast: a 6 MB phone photo becomes a
 * ~150 KB JPEG, which uploads in a fraction of a second and is still more
 * than enough for the model to name the product.
 */
async function downscale(file: File): Promise<{ base64: string; mimeType: string }> {
  const MAX = 1024;

  const bitmap = await new Promise<ImageBitmap | HTMLImageElement>((resolve, reject) => {
    if (typeof createImageBitmap === "function") {
      createImageBitmap(file).then(resolve).catch(reject);
    } else {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = reject;
      img.src = url;
    }
  });

  const w = (bitmap as any).width as number;
  const h = (bitmap as any).height as number;
  const scale = Math.min(1, MAX / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(bitmap as any, 0, 0, cw, ch);
  if ("close" in bitmap && typeof (bitmap as any).close === "function") {
    (bitmap as any).close();
  }

  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: "image/jpeg" };
}
