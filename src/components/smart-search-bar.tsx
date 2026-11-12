"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { aiParseSearch, aiCorrectSearch } from "@/app/ai-actions";
import { Spinner } from "@/components/ui";

/**
 * Natural-language search — Part 1, features 10 and 11.
 *
 * ── The AI produces FILTERS, never results ──────────────────────────────────
 * "affordable phone for good pictures under 100,000" becomes
 * `{ category: "Phones & Accessories", max_price: 100000, keywords: ["phone","camera"] }`
 * and the browser then navigates to the ordinary `/search` URL with those
 * filters. The database does the searching, exactly as it always did.
 *
 * ── Why this is a client component ──────────────────────────────────────────
 * The AI call must not block the search page render. Doing it here means the
 * page paints instantly, the AI gets its own timeout, and a failure simply
 * navigates to the plain keyword search — which is the fallback the spec asks
 * for, and it is the same URL a user would have typed anyway.
 */
export function SmartSearchBar({
  initialQuery,
  city,
  type,
}: {
  initialQuery: string;
  city?: string;
  type?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [busy, setBusy] = useState(false);
  const [understood, setUnderstood] = useState("");

  function plainSearch(text: string) {
    const p = new URLSearchParams();
    if (text) p.set("q", text);
    if (city) p.set("city", city);
    if (type) p.set("type", type);
    router.push(`/search?${p.toString()}`);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;

    setBusy(true);
    setUnderstood("");

    try {
      // 1. Try to understand the sentence as filters.
      const parsed = await aiParseSearch({ query: text });

      if (parsed.ok) {
        const p = new URLSearchParams();
        // Keywords become the query; the structured filters ride alongside.
        if (parsed.data.keywords.length > 0) p.set("q", parsed.data.keywords.join(" "));
        else p.set("q", text);
        if (parsed.data.category) p.set("category", parsed.data.category);
        if (parsed.data.max_price != null) p.set("max", String(parsed.data.max_price));
        if (parsed.data.min_price != null) p.set("min", String(parsed.data.min_price));
        if (city) p.set("city", city);
        if (type) p.set("type", type);

        setUnderstood(parsed.data.understood);
        router.push(`/search?${p.toString()}`);
        setBusy(false);
        return;
      }

      // 2. AI unavailable — try a spelling correction, then plain search.
      const fixed = await aiCorrectSearch({ query: text });
      plainSearch(fixed.ok && fixed.data.changed ? fixed.data.corrected : text);
    } catch {
      // 3. Anything at all went wrong — the keyword search still works.
      plainSearch(text);
    }
    setBusy(false);
  }

  return (
    <div>
      <form onSubmit={submit} className="flex gap-2">
        {type && <input type="hidden" name="type" value={type} />}
        {city && <input type="hidden" name="city" value={city} />}
        <div className="relative flex-1">
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          <input
            name="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Try “affordable phone for good pictures under 100,000”"
            className="nm-input !py-3 pl-10"
            aria-label="Search query"
          />
        </div>
        <button disabled={busy} className="nm-btn-primary !px-4">
          {busy ? <Spinner className="!h-4 !w-4" /> : "Search"}
        </button>
      </form>

      {understood && (
        <p className="mt-1.5 text-[11.5px] text-ink-500">
          Searching for: <span className="font-semibold text-ink-700">{understood}</span>
        </p>
      )}
    </div>
  );
}
