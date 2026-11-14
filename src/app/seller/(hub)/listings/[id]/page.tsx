import { notFound, redirect } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { getCategories, getGigPackages } from "@/lib/queries";
import { ListingForm } from "@/components/seller/listing-form";
import { PlanEditor } from "@/components/seller/plan-editor";
import { shopHasFeature } from "@/lib/plan-gate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit listing" };

export default async function EditListingPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.shop) redirect("/seller/onboarding");

  const supabase = createClient();
  const { data: listing } = await supabase
    .from("listings")
    .select("*")
    .eq("id", params.id)
    .eq("shop_id", session.shop.id)
    .maybeSingle();

  if (!listing) notFound();

  const { data: shop } = await supabase
    .from("shops")
    .select("delivery_fee,free_delivery_threshold")
    .eq("id", session.shop.id)
    .single();

  const categories = await getCategories();

  // A gig's plans are edited here, next to the gig itself — that is where a
  // seller looks when they want to change what they charge. A product has no
  // plans, so the editor is not rendered for one.
  const packages = listing.type === "service" ? await getGigPackages(listing.id) : [];

  return (
    <div className="space-y-4">
      <ListingForm
        shopId={session.shop.id}
        categories={categories.map((c: any) => ({ id: c.id, name: c.name }))}
        listing={listing}
        aiListingEnabled={await shopHasFeature(session.shop.id, "aiListing")}
        shopDefaults={{
          delivery_fee: Number(shop?.delivery_fee ?? 500),
          free_delivery_threshold: shop?.free_delivery_threshold ? Number(shop.free_delivery_threshold) : null,
        }}
      />

      {listing.type === "service" && (
        <div className="nm-card p-4">
          <PlanEditor
            listingId={listing.id}
            initialPackages={packages}
            startingPrice={Number(listing.price ?? 0)}
            startingDeliveryDays={listing.delivery_days ?? null}
          />
        </div>
      )}
    </div>
  );
}
