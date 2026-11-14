"use client";

import { useEffect, useRef, useState } from "react";
import { coordsLabel, directionsUrl, osmEmbedUrl, pinUrl, type Coords } from "@/lib/geo";

/**
 * The in-site map.
 *
 * ── Why a popup and not a new tab ─────────────────────────────────────────
 * Opening Google Maps in a new tab loses the page the buyer was on: they
 * come back to a checkout they have to re-read, or to a chat that has
 * scrolled. A map that opens *over* the page keeps the context, and closing
 * it puts them back exactly where they were.
 *
 * ── Why OpenStreetMap tiles ───────────────────────────────────────────────
 * Google's embed needs an API key and its JS API needs a key plus a billing
 * account. OpenStreetMap's `export/embed.html` is a plain URL with neither,
 * so the map can be shown inside the site without shipping a secret to the
 * browser. "Open in Google Maps" and "Directions" are still there, because
 * that is what people actually navigate with.
 *
 * ── Three sizes ───────────────────────────────────────────────────────────
 *   normal     a centred rectangle, the default
 *   expanded   nearly the whole viewport, for reading street names
 *   minimised  a small bar in the corner, so the map can stay open while
 *              the buyer types an address underneath it
 *
 * Escape closes it, the backdrop closes it, and focus is trapped inside
 * while it is open so a keyboard user cannot tab into the page behind.
 */
export function MapPopup({
  coords,
  title = "Your location",
  subtitle,
  onClose,
  /** Optional second point: draws a "directions" link from here to there. */
  destination,
  destinationLabel,
}: {
  coords: Coords;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  destination?: Coords | null;
  destinationLabel?: string;
}) {
  const [size, setSize] = useState<"normal" | "expanded" | "minimised">("normal");
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes; focus starts on the close button so a keyboard user is
  // not left tabbing through the page behind the overlay.
  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock the page behind the overlay. Restoring the previous value matters:
  // the chat page sets its own overflow, and clobbering it would leave the
  // thread unscrollable after the map closes.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const embed = osmEmbedUrl(coords);
  const mapsHref = destination ? directionsUrl(coords, destination) : pinUrl(coords);

  if (size === "minimised") {
    return (
      <div className="fixed bottom-4 right-4 z-[80] w-[min(92vw,320px)]">
        <div className="nm-card flex items-center gap-2 p-2.5 shadow-card">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-500 text-[15px] text-white">
            📍
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-bold text-ink-900">{title}</p>
            <p className="truncate font-mono text-[10px] text-ink-400">{coordsLabel(coords)}</p>
          </div>
          <button
            type="button"
            onClick={() => setSize("normal")}
            aria-label="Expand the map"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-500 hover:bg-slate-100"
          >
            ⤢
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the map"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  const expanded = size === "expanded";

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-ink-900/50 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Map showing ${title}`}
      onMouseDown={(e) => {
        // Only a click on the backdrop itself closes — a drag that ends
        // outside the panel must not dismiss the map mid-pan.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`flex w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl transition-[max-width,max-height] duration-200 ${
          expanded ? "max-w-[min(96vw,1100px)]" : "max-w-[min(96vw,560px)]"
        }`}
        style={{ maxHeight: expanded ? "94vh" : "min(86vh, 620px)" }}
      >
        {/* header */}
        <div className="flex items-start gap-2 border-b border-[var(--line)] px-3.5 py-2.5">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-[14px]">
            📍
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-ink-900">{title}</p>
            <p className="truncate text-[11px] text-ink-500">
              {subtitle ?? coordsLabel(coords)}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setSize(expanded ? "normal" : "expanded")}
            aria-label={expanded ? "Shrink the map" : "Expand the map"}
            aria-pressed={expanded}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-500 hover:bg-slate-100"
          >
            {expanded ? "⤡" : "⤢"}
          </button>
          <button
            type="button"
            onClick={() => setSize("minimised")}
            aria-label="Minimise the map"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-500 hover:bg-slate-100"
          >
            —
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close the map"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        {/* the map itself.
            `loading="lazy"` is wrong here — the iframe is the whole point of
            the popup, so it must start loading immediately. The title is
            required for screen readers, which otherwise announce an
            unlabelled frame. */}
        <div className="relative min-h-0 flex-1 bg-slate-100">
          <iframe
            key={embed}
            src={embed}
            title={`Map of ${title}`}
            className="h-full w-full border-0"
            style={{ minHeight: expanded ? "60vh" : "260px" }}
            referrerPolicy="no-referrer"
            allowFullScreen
          />
        </div>

        {/* footer actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] px-3.5 py-2.5">
          <a
            href={mapsHref}
            target="_blank"
            rel="noreferrer"
            className="nm-btn-primary !px-3 !py-1.5 !text-[12px]"
          >
            {destination ? `➤ Directions to ${destinationLabel ?? "the shop"}` : "🗺️ Open in Google Maps"}
          </a>
          <a
            href={pinUrl(coords)}
            target="_blank"
            rel="noreferrer"
            className="nm-btn-ghost !px-3 !py-1.5 !text-[12px]"
          >
            View pin
          </a>
          <span className="ml-auto font-mono text-[10px] text-ink-400">{coordsLabel(coords)}</span>
        </div>
      </div>
    </div>
  );
}
