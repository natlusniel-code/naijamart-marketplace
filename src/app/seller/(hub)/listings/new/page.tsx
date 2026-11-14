import { redirect } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { getCategories } from "@/lib/queries";
import { ListingForm } from "@/components/seller/listing-form";
import { shopHasFeature } from "@/lib/plan-gate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add listing" };

export default async function NewListingPage() {
  const session = await getSession();
  if (!session?.shop) redirect("/seller/onboarding");

  const [categories, supabase] = [await getCategories(), createClient()];
  const { data: shop } = await supabase
    .from("shops")
    .select("delivery_fee,free_delivery_threshold")
    .eq("id", session.shop.id)
    .single();

  return (
    <ListingForm
      shopId={session.shop.id}
      categories={categories.map((c: any) => ({ id: c.id, name: c.name }))}
      aiListingEnabled={await shopHasFeature(session.shop.id, "aiListing")}
      shopDefaults={{
        delivery_fee: Number(shop?.delivery_fee ?? 500),
        free_delivery_threshold: shop?.free_delivery_threshold ? Number(shop.free_delivery_threshold) : null,
      }}
    />
  );
}
