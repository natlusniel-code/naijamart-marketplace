import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, createClient } from "@/lib/supabase/server";
import { naira, shortDate } from "@/lib/utils";
import { Card, Badge, Alert } from "@/components/ui";
import { ShopSettingsForm } from "@/components/seller/shop-settings-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shop settings" };

export default async function ShopSettingsPage() {
  const session = await getSession();
  if (!session?.shop) redirect("/seller/onboarding");

  const supabase = createClient();
  const { data: shop } = await supabase.from("shops").select("*").eq("id", session.shop.id).single();
  if (!shop) redirect("/seller/onboarding");

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[21px] font-extrabold tracking-tight text-ink-900">Shop settings</h1>
        <Link href={`/shop/${shop.slug}`} className="text-[12.5px] font-semibold text-brand-600">View public page ↗</Link>
      </div>

      <Card className="p-4">
        <p className="text-[13.5px] font-bold text-ink-900">Verification</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={shop.status === "approved" ? "green" : shop.status === "pending" ? "amber" : "red"} dot>
            {shop.status === "approved" ? "Approved" : shop.status === "pending" ? "Under review" : shop.status}
          </Badge>
          <Badge tone={shop.verified ? "green" : "gray"}>{shop.verified ? "Verified seller" : "Not yet verified"}</Badge>
          <Badge tone={shop.subscription_status === "active" ? "green" : "red"}>
            {shop.subscription_status === "active" ? `Subscribed · ${shortDate(shop.subscription_expires_at)}` : "Subscription inactive"}
          </Badge>
        </div>
        {shop.review_note && (
          <div className="mt-2.5">
            <Alert tone="amber" title="Note from NaijaMart">{shop.review_note}</Alert>
          </div>
        )}
      </Card>

      <ShopSettingsForm shop={shop} />

      <Card className="p-4">
        <p className="text-[13.5px] font-bold text-ink-900">Shareable shop link</p>
        <p className="mt-1 text-[12px] text-ink-500">Send this to customers on WhatsApp or Instagram — they can browse without an account.</p>
        <code className="mt-2 block break-all rounded-xl bg-slate-50 px-3 py-2 font-mono text-[11.5px] text-ink-700">
          {typeof process !== "undefined" ? "" : ""}/shop/{shop.slug}
        </code>
      </Card>
    </div>
  );
}
