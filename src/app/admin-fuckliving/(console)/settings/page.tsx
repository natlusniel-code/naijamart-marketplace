import { createAdminClient } from "@/lib/supabase/admin";
import { Card, Badge } from "@/components/ui";
import { SettingsForm } from "@/components/admin/settings-form";
import { CategoryManager } from "@/components/admin/category-manager";
import { PlanEditor } from "@/components/admin/plan-editor";
import { naira } from "@/lib/utils";
import { getSellerPlans } from "@/lib/plan-gate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  const supabase = createAdminClient();
  const [{ data: settings }, { data: categories }, plans] = await Promise.all([
    supabase.from("platform_settings").select("*").eq("id", 1).single(),
    supabase.from("categories").select("*").order("sort_order"),
    getSellerPlans(),
  ]);

  const cats = categories ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">Settings</h1>
        <Badge tone="blue">applies to new activity only</Badge>
      </div>

      <Card className="p-4">
        <p className="text-[14px] font-bold text-ink-900">Commission & subscription</p>
        <p className="mt-0.5 text-[12px] text-ink-500">
          Changing the commission rate doesn&apos;t rewrite past orders — each order stores the rate it was charged at.
        </p>
        {settings && (
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-[10.5px] uppercase tracking-wide text-ink-400">Commission</p>
              <p className="font-extrabold text-ink-900">{(Number(settings.commission_rate) * 100).toFixed(1)}%</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-[10.5px] uppercase tracking-wide text-ink-400">Subscription</p>
              <p className="font-extrabold text-ink-900">{naira(settings.subscription_price)}/mo</p>
            </div>
          </div>
        )}
        <div className="mt-3">
          <SettingsForm settings={settings} />
        </div>
      </Card>

      {/* ── Seller plans ───────────────────────────────────────────────
          The Premium price is edited here. The seller's comparison screen,
          the checkout amount and the feature gate all read the same rows,
          so a change here is live everywhere at once. */}
      <Card className="p-4">
        <p className="text-[14px] font-bold text-ink-900">Seller plans</p>
        <p className="mt-0.5 mb-2.5 text-[12px] leading-relaxed text-ink-500">
          The price and tagline of each plan. Every seller feature is gated on an active
          subscription, and which features a plan includes is what the gate reads.
        </p>
        <PlanEditor plans={plans} />
      </Card>

      <Card className="p-4">
        <p className="text-[14px] font-bold text-ink-900">Categories</p>
        <p className="mt-0.5 text-[12px] text-ink-500">{cats.length} categories · shown in the buyer home strip and seller dropdowns.</p>
        <div className="mt-2.5">
          <CategoryManager categories={cats} />
        </div>
      </Card>
    </div>
  );
}
