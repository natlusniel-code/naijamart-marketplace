import { getSession, createClient } from "@/lib/supabase/server";
import { CheckoutFlow } from "@/components/checkout-flow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const session = await getSession();

  let addresses: any[] = [];
  let account: {
    bank_name: string;
    account_number: string;
    account_name: string;
    label: string | null;
  } | null = null;

  if (session) {
    const supabase = createClient();

    const { data } = await supabase
      .from("addresses")
      .select("id,label,line1,city,state,phone,is_default")
      .eq("user_id", session.user.id)
      .order("is_default", { ascending: false });
    addresses = data ?? [];

    // The account to pay into is reserved server-side (sql/0011) and is
    // reused for this buyer for a few hours, so the account shown here is
    // the account stored on the order. With more than one active account
    // the reservation rotates, so a repeat buyer sees a different one and
    // two buyers do not all get the same account.
    const { data: acct } = await supabase.rpc("my_payment_account");
    const row = Array.isArray(acct) ? acct[0] : acct;
    if (row) {
      account = {
        bank_name: row.bank_name,
        account_number: row.account_number,
        account_name: row.account_name,
        label: row.label ?? null,
      };
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-ink-900">Checkout</h1>
      <p className="mb-4 text-[13px] text-ink-500">
        Transfer to NaijaMart, upload your receipt, and we hold the money until delivery.
      </p>

      <CheckoutFlow
        signedIn={!!session}
        isBanned={!!session?.profile.is_banned}
        profileCity={session?.profile.city ?? null}
        profileState={session?.profile.state ?? null}
        account={account}
        addresses={addresses}
      />
    </div>
  );
}
