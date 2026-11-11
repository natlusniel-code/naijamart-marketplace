import { notFound, redirect } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { getCategories } from "@/lib/queries";
import { ListingForm } from "@/components/seller/listing-form";

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

  return (
    <ListingForm
      shopId={session.shop.id}
      categories={categories.map((c: any) => ({ id: c.id, name: c.name }))}
      listing={listing}
      shopDefaults={{
        delivery_fee: Number(shop?.delivery_fee ?? 500),
        free_delivery_threshold: shop?.free_delivery_threshold ? Number(shop.free_delivery_threshold) : null,
      }}
    />
  );
}
