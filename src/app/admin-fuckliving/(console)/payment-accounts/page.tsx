import { createAdminClient } from "@/lib/supabase/admin";
import { Card } from "@/components/ui";
import { PaymentAccountsManager } from "@/components/admin/payment-accounts-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payment accounts" };

export default async function AdminPaymentAccountsPage() {
  const supabase = createAdminClient();
  const { data: accounts } = await supabase
    .from("payment_accounts")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">Payment accounts</h1>
        <p className="mt-0.5 text-[12.5px] text-ink-500">
          The bank accounts buyers transfer into. Add as many as you need — buyers are rotated
          across the active ones.
        </p>
      </div>

      <Card className="p-4">
        <PaymentAccountsManager accounts={accounts ?? []} />
      </Card>
    </div>
  );
}
