import { createAdminClient } from "@/lib/supabase/admin";
import { Card, Badge, EmptyState } from "@/components/ui";
import { SafetyQueue } from "@/components/admin/safety-queue";
import { shortDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trust & safety" };

/**
 * The AI trust & safety queue.
 *
 * ── Why this is a queue and not a list ───────────────────────────────────
 * A report is only useful if it is acted on. So the page is ordered by
 * risk score, each row carries the findings that produced the score, and
 * every row has the three decisions an admin actually makes: reviewed,
 * actioned, dismissed. A report that is never triaged is noise.
 *
 * ── Why the findings are shown, not just the score ───────────────────────
 * "87/100" tells an admin nothing they can act on. "Asks the buyer to
 * transfer to a personal account — evidence: 'send to 0123456789'" tells
 * them exactly what to do. The score is the sort key; the findings are the
 * content.
 */
export default async function SafetyPage() {
  const supabase = createAdminClient();

  const { data: reports } = await supabase
    .from("ai_safety_reports")
    .select("id,subject_type,subject_id,risk_level,score,summary,findings,status,created_at")
    .order("status", { ascending: true })
    .order("score", { ascending: false })
    .limit(60);

  const rows = reports ?? [];
  const open = rows.filter((r: any) => r.status === "open");
  const critical = open.filter((r: any) => r.risk_level === "critical" || r.risk_level === "high");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">Trust &amp; safety</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-500">
            AI reports on listings, shops and reviews. Highest risk first.
          </p>
        </div>
        <div className="flex gap-1.5">
          <Badge tone={critical.length ? "red" : "green"} dot>
            {critical.length} high risk
          </Badge>
          <Badge tone="gray">{open.length} open</Badge>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            icon="🛡️"
            title="No reports yet"
            body="Run a check on a listing, shop or review and its report will appear here."
          />
        </Card>
      ) : (
        <SafetyQueue
          reports={rows.map((r: any) => ({
            id: r.id,
            subjectType: r.subject_type,
            subjectId: r.subject_id,
            riskLevel: r.risk_level,
            score: Number(r.score ?? 0),
            summary: r.summary ?? "",
            findings: Array.isArray(r.findings) ? r.findings : [],
            status: r.status,
            createdAt: shortDate(r.created_at),
          }))}
        />
      )}
    </div>
  );
}
