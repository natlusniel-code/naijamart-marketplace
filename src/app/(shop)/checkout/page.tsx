import { getSession, createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/queries";
import { CheckoutFlow } from "@/components/checkout-flow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const session = await getSession();
  const settings = await getSettings();

  let addresses: any[] = [];
  if (session) {
    const supabase = createClient();
    const { data } = await supabase
      .from("addresses")
      .select("id,label,line1,city,state,phone,is_default")
      .eq("user_id", session.user.id)
      .order("is_default", { ascending: false });
    addresses = data ?? [];
  }

  return (
    <div>
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-ink-900">Checkout</h1>
      <p className="mb-4 text-[13px] text-ink-500">Transfer to NaijaMart, upload your receipt, and we hold the money until delivery.</p>

      <CheckoutFlow
        signedIn={!!session}
        isBanned={!!session?.profile.is_banned}
        profileCity={session?.profile.city ?? null}
        settings={settings}
        addresses={addresses}
      />
    </div>
  );
}
