import { Card } from "@/components/ui";
import { AdminCopilot } from "@/components/admin/admin-copilot";

export const dynamic = "force-dynamic";
export const metadata = { title: "Copilot" };

/**
 * The AI admin copilot.
 *
 * ── What it is ───────────────────────────────────────────────────────────
 * A question box over the platform's live data. "How much is waiting to be
 * verified?", "which seller has the most disputes?", "what did we make
 * this week?" — answered from the database, with the rows it used shown
 * underneath so the admin can check the working.
 *
 * ── What it cannot do ────────────────────────────────────────────────────
 * It cannot change anything. Every action that moves money or state stays
 * a button on its own page. The copilot reads and explains; the admin
 * decides.
 */
export default function CopilotPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">Copilot</h1>
        <p className="mt-0.5 text-[12.5px] text-ink-500">
          Ask about payments, payouts, disputes, sellers or orders. It reads live data and cannot
          change anything.
        </p>
      </div>

      <Card className="p-4">
        <AdminCopilot />
      </Card>
    </div>
  );
}
