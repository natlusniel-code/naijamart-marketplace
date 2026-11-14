"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setSafetyReportStatus } from "@/app/admin-fuckliving/ai-actions";
import { Badge, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

type Finding = {
  rule?: string;
  severity?: string;
  detail?: string;
  evidence?: string;
};

type Report = {
  id: string;
  subjectType: string;
  subjectId: string;
  riskLevel: string;
  score: number;
  summary: string;
  findings: Finding[];
  status: string;
  createdAt: string;
};

const RISK_TONE: Record<string, "red" | "amber" | "blue" | "gray"> = {
  critical: "red",
  high: "red",
  medium: "amber",
  low: "gray",
};

/**
 * The safety queue.
 *
 * Each report expands to show its findings — the rule, the severity, what
 * is wrong and the exact words that triggered it. That last part is what
 * makes a report actionable: an admin can see the phone number the AI
 * found rather than being told one exists.
 */
export function SafetyQueue({ reports }: { reports: Report[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(reports[0]?.id ?? null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function decide(id: string, status: "reviewed" | "actioned" | "dismissed") {
    setErr("");
    setBusy(id);
    const result = await setSafetyReportStatus({ id, status });
    setBusy("");
    if (!result.ok) {
      setErr(result.error ?? "Could not update.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {err && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">{err}</p>
      )}

      {reports.map((r) => {
        const isOpen = open === r.id;
        const done = r.status !== "open";

        return (
          <div
            key={r.id}
            className={cn(
              "overflow-hidden rounded-xl border bg-white",
              done ? "border-[var(--line)] opacity-70" : "border-[var(--line)]",
            )}
          >
            <button
              onClick={() => setOpen(isOpen ? null : r.id)}
              className="flex w-full items-start gap-3 px-3.5 py-3 text-left transition hover:bg-slate-50"
              aria-expanded={isOpen}
            >
              <span
                className={cn(
                  "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[12px] font-extrabold",
                  r.riskLevel === "critical" || r.riskLevel === "high"
                    ? "bg-red-50 text-red-700"
                    : r.riskLevel === "medium"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-slate-100 text-ink-500",
                )}
              >
                {r.score}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={RISK_TONE[r.riskLevel] ?? "gray"}>{r.riskLevel}</Badge>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                    {r.subjectType}
                  </span>
                  {done && <Badge tone="gray">{r.status}</Badge>}
                </span>
                <span className="mt-1 block text-[12.5px] leading-snug text-ink-800">
                  {r.summary}
                </span>
                <span className="mt-0.5 block text-[11px] text-ink-400">
                  {r.findings.length} finding{r.findings.length === 1 ? "" : "s"} · {r.createdAt}
                </span>
              </span>

              <span className="shrink-0 text-[11px] font-semibold text-brand-600">
                {isOpen ? "Close" : "Open"}
              </span>
            </button>

            {isOpen && (
              <div className="border-t border-[var(--line)] bg-slate-50/60 px-3.5 py-3">
                {r.findings.length === 0 ? (
                  <p className="text-[12px] text-ink-500">
                    No rule was broken. This report is clean.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {r.findings.map((f, i) => (
                      <li key={i} className="rounded-lg bg-white px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={RISK_TONE[f.severity ?? "low"] ?? "gray"}>
                            {f.severity ?? "low"}
                          </Badge>
                          <span className="font-mono text-[10.5px] text-ink-400">
                            {f.rule ?? "rule"}
                          </span>
                        </div>
                        <p className="mt-1 text-[12px] leading-snug text-ink-800">{f.detail}</p>
                        {f.evidence && (
                          <p className="mt-1 rounded bg-slate-50 px-2 py-1 font-mono text-[11px] text-ink-600">
                            “{f.evidence}”
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <a
                    href={
                      r.subjectType === "listing"
                        ? `/listing/${r.subjectId}`
                        : r.subjectType === "shop"
                          ? `/admin-fuckliving/sellers`
                          : `/admin-fuckliving/reviews`
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="nm-btn-ghost !px-3 !py-1.5 !text-[11.5px]"
                  >
                    View subject ↗
                  </a>
                  {!done && (
                    <>
                      <button
                        onClick={() => decide(r.id, "reviewed")}
                        disabled={!!busy}
                        className="nm-btn-ghost !px-3 !py-1.5 !text-[11.5px]"
                      >
                        {busy === r.id ? <Spinner /> : "Mark reviewed"}
                      </button>
                      <button
                        onClick={() => decide(r.id, "actioned")}
                        disabled={!!busy}
                        className="nm-btn-primary !px-3 !py-1.5 !text-[11.5px]"
                      >
                        Actioned
                      </button>
                      <button
                        onClick={() => decide(r.id, "dismissed")}
                        disabled={!!busy}
                        className="nm-btn-ghost !px-3 !py-1.5 !text-[11.5px] !text-ink-500"
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
