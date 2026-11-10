import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { naira } from "@/lib/utils";
import { Badge, EmptyState, Card } from "@/components/ui";
import { ListingRowActions } from "@/components/seller/listing-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your listings" };

const STATUS_TONE: Record<string, "green" | "amber" | "gray" | "red"> = {
  live: "green",
  draft: "amber",
  hidden: "gray",
  out_of_stock: "red",
};

export default async function SellerListingsPage() {
  const session = await getSession();
  if (!session) redirect("/signin");
  if (!session.shop) redirect("/seller/onboarding");

  const supabase = createClient();
  const { data: listings } = await supabase
    .from("listings")
    .select("id,title,type,price,stock,status,images,created_at")
    .eq("shop_id", session.shop.id)
    .order("created_at", { ascending: false });

  const list = listings ?? [];
  const lowStock = list.filter((l: any) => l.type === "product" && l.status === "live" && l.stock <= 5);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[21px] font-extrabold tracking-tight text-ink-900">Listings</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-500">{list.length} total · {list.filter((l: any) => l.status === "live").length} live</p>
        </div>
        <Link href="/seller/listings/new" className="nm-btn-primary">+ Add listing</Link>
      </div>

      {lowStock.length > 0 && (
        <Card className="border-amber-500/25 bg-amber-50/60 p-3">
          <p className="text-[12.5px] font-bold text-amber-900">Low stock ({lowStock.length})</p>
          <p className="mt-0.5 text-[12px] text-amber-900/80">
            {lowStock.map((l: any) => `${l.title} (${l.stock})`).join(" · ")}
          </p>
        </Card>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon="➕"
          title="No listings yet"
          body="Add your first product or service. Live listings show up on your public shop page and in search."
          action="Add your first listing"
          href="/seller/listings/new"
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((l: any) => (
            <div key={l.id} className="nm-card overflow-hidden">
              <div className="flex gap-3 p-3">
                <Link href={`/listing/${l.id}`} className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                  {l.images?.[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.images[0]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-lg text-slate-300">📦</div>
                  )}
                </Link>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink-900">{l.title}</p>
                  <p className="mt-0.5 text-[13px] font-bold text-ink-900">{naira(l.price)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={STATUS_TONE[l.status] ?? "gray"}>{l.status.replace("_", " ")}</Badge>
                    <Badge tone="gray">{l.type}</Badge>
                    {l.type === "product" && (
                      <span className={`text-[11px] ${l.stock <= 5 ? "font-semibold text-amber-600" : "text-ink-400"}`}>
                        {l.stock} left
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="border-t border-[var(--line)] bg-slate-50/50 px-3 py-1.5">
                <ListingRowActions id={l.id} status={l.status} title={l.title} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
