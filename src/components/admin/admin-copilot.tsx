"use client";

import { useEffect, useRef, useState } from "react";
import { askAdminCopilot, getCopilotCapabilities } from "@/app/admin-fuckliving/ai-actions";
import { Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

type Turn = {
  role: "user" | "assistant";
  body: string;
  /** The rows the answer was based on, for the "show the data" expander. */
  data?: unknown;
  tools?: { name: string }[];
  schemaTables?: number;
};

type Capability = { name: string; columns: number; rows: number | null };

/**
 * The questions an admin actually asks, as one-tap starters.
 *
 * The last three deliberately reach past the named queries — enquiries,
 * offers and reviews are tables the old copilot could not see at all, so
 * they double as a demonstration that the whole database is now in scope.
 */
const STARTERS = [
  "How are we doing this month?",
  "What payments are waiting to be verified?",
  "Which payouts are due?",
  "What disputes are still open?",
  "Which sellers are performing best?",
  "How many enquiries came in this week?",
  "What offers are pending?",
  "Show me the most recent reviews",
];

/**
 * The copilot chat.
 *
 * ── Why the data is shown ────────────────────────────────────────────────
 * An answer like "₦1.2m this month" is only trustworthy if the admin can
 * see the rows behind it. Every answer carries a collapsible "show the
 * data" panel with the exact query output, so a wrong answer is
 * diagnosable rather than mysterious.
 *
 * ── Why the schema panel ─────────────────────────────────────────────────
 * The copilot can now read every table in the database, but an admin
 * cannot ask about a table they do not know exists. The panel lists the
 * live tables with their row counts, read from the same snapshot the
 * copilot uses, so the two can never disagree. Clicking a table name drops
 * it into the question box.
 */
export function AdminCopilot() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [caps, setCaps] = useState<Capability[] | null>(null);
  const [capsAsOf, setCapsAsOf] = useState<string | null>(null);
  const [showSchema, setShowSchema] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load the live table list once, so the admin can see the scope.
  useEffect(() => {
    let alive = true;
    getCopilotCapabilities().then((r) => {
      if (!alive || !r.ok) return;
      setCaps(r.tables ?? []);
      setCapsAsOf(r.asOf ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;

    setErr("");
    setText("");
    setBusy(true);

    const history = turns.map((t) => ({ role: t.role, body: t.body }));
    setTurns((prev) => [...prev, { role: "user", body: q }]);

    const result = await askAdminCopilot({ question: q, history });
    setBusy(false);

    if (!result.ok) {
      setErr(result.error ?? "The copilot could not answer.");
      return;
    }

    setTurns((prev) => [
      ...prev,
      {
        role: "assistant",
        body: result.answer ?? "",
        data: result.data,
        tools: (result.tools as { name: string }[]) ?? [],
        schemaTables: result.schemaTables,
      },
    ]);

    // Scroll the newest answer into view.
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  /** Drop a table name into the question box and focus it. */
  function useTable(name: string) {
    setText(`Show me the most recent rows in ${name}`);
    inputRef.current?.focus();
  }

  const totalRows = caps?.reduce((a, c) => a + (c.rows ?? 0), 0) ?? 0;

  return (
    <div className="space-y-3">
      {/* ── What the copilot can see ─────────────────────────────────── */}
      {caps && caps.length > 0 && (
        <div className="rounded-xl border border-[var(--line)] bg-slate-50/60 p-3">
          <button
            type="button"
            onClick={() => setShowSchema((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-expanded={showSchema}
          >
            <span className="text-[11.5px] font-semibold text-ink-700">
              Connected to the live database — {caps.length} tables
              {totalRows > 0 ? `, ${totalRows.toLocaleString()} rows` : ""}
            </span>
            <span className="text-[11px] font-semibold text-brand-700">
              {showSchema ? "Hide tables" : "Show tables"}
            </span>
          </button>

          {showSchema && (
            <div className="mt-2.5">
              <div className="flex flex-wrap gap-1.5">
                {caps.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => useTable(c.name)}
                    title={`${c.columns} columns${c.rows != null ? `, ${c.rows} rows` : ""}`}
                    className="rounded-full border border-[var(--line)] bg-white px-2.5 py-1 text-[10.5px] font-semibold text-ink-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                  >
                    {c.name}
                    {c.rows != null && (
                      <span className="ml-1 text-ink-400">{c.rows.toLocaleString()}</span>
                    )}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10.5px] leading-relaxed text-ink-400">
                Every table in the database is readable. Tap one to ask about it.
                {capsAsOf && ` Schema read ${new Date(capsAsOf).toLocaleTimeString()}.`}
              </p>
            </div>
          )}
        </div>
      )}

      {turns.length === 0 && (
        <div className="flex flex-wrap gap-1.5">
          {STARTERS.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              className="rounded-full border border-[var(--line)] px-3 py-1.5 text-[11.5px] font-semibold text-ink-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2.5">
        {turns.map((t, i) => (
          <div
            key={i}
            className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2.5",
                t.role === "user"
                  ? "bg-ink-900 text-white"
                  : "border border-[var(--line)] bg-white",
              )}
            >
              <p
                className={cn(
                  "whitespace-pre-wrap text-[12.5px] leading-relaxed",
                  t.role === "user" ? "text-white" : "text-ink-800",
                )}
              >
                {t.body}
              </p>

              {t.role === "assistant" && t.data != null && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] font-semibold text-ink-400">
                    Show the data
                    {t.tools?.length ? ` (${t.tools.map((x) => x.name).join(", ")})` : ""}
                  </summary>
                  <pre className="mt-1.5 max-h-64 overflow-auto rounded-lg bg-slate-50 p-2 text-[10.5px] leading-relaxed text-ink-600">
                    {JSON.stringify(t.data, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-[var(--line)] bg-white px-3.5 py-2.5">
              <Spinner />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {err && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">{err}</p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
        className="flex gap-2"
      >
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask about anything — orders, enquiries, offers, reviews, sellers…"
          className="nm-input flex-1"
          aria-label="Ask the copilot"
        />
        <button disabled={busy || !text.trim()} className="nm-btn-primary !px-4">
          Ask
        </button>
      </form>

      <p className="text-[11px] leading-relaxed text-ink-400">
        The copilot reads live data and cannot change anything. To verify a payment, release a
        payout or suspend a shop, use the page for it.
      </p>
    </div>
  );
}
