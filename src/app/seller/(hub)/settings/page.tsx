import { redirect } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { getSession, createClient } from "@/lib/supabase/server";
import { naira, shortDate } from "@/lib/utils";
import { Card, Badge, Alert } from "@/components/ui";
import { ShopSettingsForm } from "@/components/seller/shop-settings-form";
import { SellerFaqManager } from "@/components/seller/seller-faq-manager";
import { CopyLinkButton } from "@/components/copy-link-button";
import { shopHasFeature } from "@/lib/plan-gate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shop settings" };

export default async function ShopSettingsPage() {
  const session = await getSession();
  if (!session?.shop) redirect("/seller/onboarding");

  const supabase = createClient();
  const { data: shop } = await supabase.from("shops").select("*").eq("id", session.shop.id).single();
  if (!shop) redirect("/seller/onboarding");

  // Absolute URL on whatever host is serving this page, so the copied link
  // opens the real public shop page anywhere (WhatsApp, Instagram, a
  // different device). Falls back to the production domain when the host
  // header is unavailable.
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${proto}://${host}` : "https://naijamart-marketplace-opal.vercel.app";
  const shopUrl = `${origin}/shop/${shop.slug}`;

  // ── Seller FAQs are a Premium feature ──────────────────────────────────
  // Gated on the SAME key the AI reply itself uses (`aiReply`), so the
  // editor and the feature it feeds can never disagree. A Basic seller
  // never sees the editor; the server actions re-check the gate anyway.
  const faqEnabled = await shopHasFeature(shop.id, "aiReply");
  const { data: faqs } = faqEnabled
    ? await supabase
        .from("seller_faqs")
        .select("id,question,answer,sort_order")
        .eq("shop_id", shop.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
    : { data: [] };

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

      {/* Premium only — the AI reply is conditioned on these answers. */}
      {faqEnabled && <SellerFaqManager initialFaqs={faqs ?? []} />}

      <Card className="p-4">
        <p className="text-[13.5px] font-bold text-ink-900">Shareable shop link</p>
        <p className="mt-1 text-[12px] text-ink-500">Send this to customers on WhatsApp or Instagram — they can browse without an account.</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-xl bg-slate-50 px-3 py-2 font-mono text-[11.5px] text-ink-700">
            {shopUrl}
          </code>
          <CopyLinkButton url={shopUrl} />
        </div>
        <a
          href={shopUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-[12px] font-semibold text-brand-600"
        >
          Open my shop page ↗
        </a>
      </Card>
    </div>
  );
}
