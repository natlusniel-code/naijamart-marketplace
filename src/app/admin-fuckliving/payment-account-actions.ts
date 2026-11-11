"use server";

/**
 * Payment-account writes for the admin console.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * The payment-accounts page used to call
 * `supabase.rpc("admin_save_payment_account", …)` and
 * `supabase.rpc("admin_delete_payment_account", …)` straight from the browser.
 * Both RPCs (sql/0011) open with:
 *
 *     if not public.is_admin() then raise exception 'Admins only.'; end if;
 *
 * and `public.is_admin()` is true only when the caller has a row in
 * `public.admin_users`. The console itself has no sign-in gate — it reads
 * through the service role — so a signed-in admin whose account was never
 * inserted into `admin_users` (or every admin at all, on a project where that
 * table is empty) got "Admins only." on every save and nothing was written.
 *
 * The write now happens here, server-side, exactly like the rest of
 * `actions.ts`: the service-role client is the authorisation, and the browser
 * never sees that key. The rules the RPC enforced are reproduced explicitly —
 * the three required fields, and deactivate-instead-of-delete when an order
 * already references the account, so order history keeps a real row to point
 * at.
 */
import { revalidatePath } from "next/cache";
import { createAdminClient, hasAdminKey } from "@/lib/supabase/admin";

/** Same `{ ok, error }` shape `actions.ts` returns, declared here so this
 *  module is self-contained (a bundled server action must own its types). */
export type ActionResult = { ok: boolean; error?: string };

const NO_KEY =
  "SUPABASE_SERVICE_ROLE_KEY is not set on the server, so admin writes are disabled. See README §1d.";

function fail(error: unknown): ActionResult {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : (error as { message?: string } | null)?.message ?? "Something went wrong.";
  return { ok: false, error: message };
}

function refresh() {
  revalidatePath("/admin-fuckliving/payment-accounts");
  revalidatePath("/admin-fuckliving");
  revalidatePath("/checkout");
}

export type PaymentAccountInput = {
  id?: string | null;
  bank_name: string;
  account_number: string;
  account_name: string;
  label?: string | null;
  note?: string | null;
  active?: boolean;
  sort_order?: number;
};

/** Create a payment account, or update one when `id` is set. */
export async function savePaymentAccount(
  input: PaymentAccountInput,
): Promise<ActionResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };

  const bankName = (input.bank_name ?? "").trim();
  const accountNumber = (input.account_number ?? "").trim();
  const accountName = (input.account_name ?? "").trim();

  if (!bankName || !accountNumber || !accountName) {
    return {
      ok: false,
      error: "Bank name, account number and account name are all required.",
    };
  }

  const sortOrder = Number(input.sort_order);
  const row = {
    bank_name: bankName,
    account_number: accountNumber,
    account_name: accountName,
    label: (input.label ?? "").trim() || null,
    note: (input.note ?? "").trim() || null,
    active: input.active ?? true,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
  };

  try {
    const supabase = createAdminClient();

    if (input.id) {
      const { data, error } = await supabase
        .from("payment_accounts")
        .update(row)
        .eq("id", input.id)
        .select("id");
      if (error) return fail(error);
      if (!data?.length) return { ok: false, error: "Account not found." };
    } else {
      const { error } = await supabase.from("payment_accounts").insert(row);
      if (error) return fail(error);
    }

    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Remove an account — deactivating it instead when an order used it. */
export async function deletePaymentAccount(id: string): Promise<ActionResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };

  try {
    const supabase = createAdminClient();

    const { data: used, error: usedErr } = await supabase
      .from("orders")
      .select("id")
      .eq("payment_account_id", id)
      .limit(1);
    if (usedErr) return fail(usedErr);

    if (used?.length) {
      const { error } = await supabase
        .from("payment_accounts")
        .update({ active: false })
        .eq("id", id);
      if (error) return fail(error);
    } else {
      const { error } = await supabase
        .from("payment_accounts")
        .delete()
        .eq("id", id);
      if (error) return fail(error);
    }

    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
