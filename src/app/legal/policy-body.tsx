"use client";

import { useMemo, useState } from "react";
import { POLICY_SECTIONS, policySearchText } from "./policy-content";

/**
 * Searchable policy body.
 *
 * The full text is rendered on the server-visible page (no JS needed to
 * read it); this component only adds a filter box and a table of
 * contents. Filtering hides sections that do not match, and announces
 * the result count to screen readers.
 */
export function PolicyBody() {
  const [q, setQ] = useState("");

  const query = q.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!query) return POLICY_SECTIONS;
    return POLICY_SECTIONS.filter((s) => policySearchText(s).includes(query));
  }, [query]);

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-4 mb-5 border-b border-[var(--line)] bg-[var(--bg)] px-4 py-3">
        <label htmlFor="policy-search" className="sr-only">
          Search this policy
        </label>
        <div className="relative">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            id="policy-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search this policy — e.g. refund, escrow, prohibited"
            className="nm-input !pl-9"
            aria-describedby="policy-search-status"
          />
        </div>
        <p id="policy-search-status" role="status" aria-live="polite" className="mt-1.5 text-[11.5px] text-ink-500">
          {query
            ? `${matches.length} of ${POLICY_SECTIONS.length} sections match “${q.trim()}”.`
            : `${POLICY_SECTIONS.length} sections.`}
        </p>
      </div>

      {/* table of contents */}
      <nav aria-label="Policy sections" className="mb-6 rounded-2xl border border-[var(--line)] bg-white p-4">
        <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-400">On this page</p>
        <ol className="grid gap-1 sm:grid-cols-2">
          {POLICY_SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="block rounded-lg px-2 py-1 text-[12.5px] text-ink-600 hover:bg-brand-50 hover:text-brand-700"
              >
                {s.number}. {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {matches.length === 0 && (
        <p className="rounded-xl border border-[var(--line)] bg-white p-4 text-[13px] text-ink-600">
          No section matches “{q.trim()}”. Try a shorter word, or clear the search to read the whole policy.
        </p>
      )}

      <div className="space-y-7">
        {matches.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-heading`} className="scroll-mt-24">
            <h2 id={`${s.id}-heading`} className="text-[16px] font-extrabold tracking-tight text-ink-900">
              {s.number}. {s.title}
            </h2>
            <div className="mt-2 space-y-2.5">
              {s.body.map((p, i) => (
                <p key={i} className="text-[13.5px] leading-relaxed text-ink-600">
                  {p}
                </p>
              ))}
              {s.bullets && (
                <ul className="ml-4 list-disc space-y-1 text-[13.5px] leading-relaxed text-ink-600">
                  {s.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
