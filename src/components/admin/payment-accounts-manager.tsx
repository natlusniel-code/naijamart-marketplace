"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Spinner, Alert, Badge } from "@/components/ui";

export type PaymentAccount = {
  id: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  label: string | null;
  note: string | null;
  active: boolean;
  sort_order: number;
  assigned_count: number;
  last_assigned_at: string | null;
};

const EMPTY = {
  id: "",
  bank_name: "",
  account_number: "",
  account_name: "",
  label: "",
  note: "",
  active: true,
  sort_order: "0",
};

/**
 * Admin management for the payment accounts buyers transfer into.
 *
 * All writes go through `admin_save_payment_account` /
 * `admin_delete_payment_account` (sql/0011), which check `is_admin()`
 * server-side. The list itself is admin-only under RLS.
 */
export function PaymentAccountsManager({ accounts }: { accounts: PaymentAccount[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const editing = !!form.id;

  function reset() {
    setForm({ ...EMPTY });
    setErr("");
  }

  function edit(a: PaymentAccount) {
    setForm({
      id: a.id,
      bank_name: a.bank_name,
      account_number: a.account_number,
      account_name: a.account_name,
      label: a.label ?? "",
      note: a.note ?? "",
      active: a.active,
      sort_order: String(a.sort_order ?? 0),
    });
    setErr("");
    setOk("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setOk("");

    const supabase = createClient();
    const { error } = await supabase.rpc("admin_save_payment_account", {
      p_id: form.id || null,
      p_bank_name: form.bank_name.trim(),
      p_account_number: form.account_number.trim(),
      p_account_name: form.account_name.trim(),
      p_label: form.label.trim() || null,
      p_note: form.note.trim() || null,
      p_active: form.active,
      p_sort_order: Number(form.sort_order) || 0,
    });

    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setOk(editing ? "Account updated." : "Account added.");
    setForm({ ...EMPTY });
    router.refresh();
  }

  async function toggle(a: PaymentAccount) {
    setBusy(true);
    setErr("");
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_save_payment_account", {
      p_id: a.id,
      p_bank_name: a.bank_name,
      p_account_number: a.account_number,
      p_account_name: a.account_name,
      p_label: a.label,
      p_note: a.note,
      p_active: !a.active,
      p_sort_order: a.sort_order,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  async function remove(a: PaymentAccount) {
    if (!confirm(`Remove ${a.bank_name} ${a.account_number}? Orders that used it keep their record.`)) return;
    setBusy(true);
    setErr("");
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_delete_payment_account", { p_id: a.id });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  const activeCount = accounts.filter((a) => a.active).length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--line)] bg-slate-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-600">
        <p className="font-bold text-ink-900">
          {activeCount} active {activeCount === 1 ? "account" : "accounts"}
        </p>
        <p className="mt-1">
          {activeCount <= 1
            ? "With one active account, every buyer is shown it."
            : "With more than one active account, buyers are rotated: a repeat buyer gets a different account from last time, and two buyers do not all see the same one. The account is assigned on the server when the order is created."}
        </p>
      </div>

      {err && <Alert tone="red">{err}</Alert>}
      {ok && <Alert tone="green">{ok}</Alert>}

      <form onSubmit={save} className="space-y-2.5 rounded-2xl border border-[var(--line)] bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-[13.5px] font-bold text-ink-900">
            {editing ? "Edit account" : "Add a payment account"}
          </p>
          {editing && (
            <button type="button" onClick={reset} className="text-[12px] font-semibold text-ink-500 hover:text-ink-900">
              Cancel
            </button>
          )}
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <div>
            <label className="nm-label" htmlFor="pa-bank">Bank name</label>
            <input
              id="pa-bank"
              className="nm-input"
              value={form.bank_name}
              onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))}
              placeholder="GTBank"
              required
            />
          </div>
          <div>
            <label className="nm-label" htmlFor="pa-number">Account number</label>
            <input
              id="pa-number"
              className="nm-input"
              inputMode="numeric"
              value={form.account_number}
              onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value.replace(/\D/g, "") }))}
              placeholder="0123456789"
              required
            />
          </div>
        </div>

        <div>
          <label className="nm-label" htmlFor="pa-name">Account name</label>
          <input
            id="pa-name"
            className="nm-input"
            value={form.account_name}
            onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))}
            placeholder="NaijaMart Ltd"
            required
          />
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <div>
            <label className="nm-label" htmlFor="pa-label">Label (optional)</label>
            <input
              id="pa-label"
              className="nm-input"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="Main / Backup"
            />
          </div>
          <div>
            <label className="nm-label" htmlFor="pa-order">Order</label>
            <input
              id="pa-order"
              className="nm-input"
              inputMode="numeric"
              value={form.sort_order}
              onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value.replace(/\D/g, "") }))}
            />
          </div>
        </div>

        <div>
          <label className="nm-label" htmlFor="pa-note">Note (optional, admin only)</label>
          <input
            id="pa-note"
            className="nm-input"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="Settlement account for Lagos branch"
          />
        </div>

        <label className="flex items-center gap-2 text-[12.5px] font-medium text-ink-700">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300"
          />
          Active — buyers can be assigned this account
        </label>

        <button type="submit" disabled={busy} className="nm-btn-primary w-full !py-2.5">
          {busy ? <><Spinner /> Saving…</> : editing ? "Save changes" : "Add account"}
        </button>
      </form>

      <div className="space-y-2">
        {accounts.length === 0 && (
          <p className="rounded-xl border border-dashed border-[var(--line)] p-4 text-center text-[12.5px] text-ink-500">
            No payment accounts yet. Add one above so buyers know where to transfer.
          </p>
        )}

        {accounts.map((a) => (
          <div key={a.id} className="rounded-xl border border-[var(--line)] bg-white p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-bold text-ink-900">
                  {a.bank_name}
                  {a.label && <span className="text-[11.5px] font-medium text-ink-400">· {a.label}</span>}
                  <Badge tone={a.active ? "green" : "gray"}>{a.active ? "Active" : "Inactive"}</Badge>
                </p>
                <p className="mt-0.5 font-mono text-[12.5px] tracking-wide text-ink-700">{a.account_number}</p>
                <p className="text-[12px] text-ink-500">{a.account_name}</p>
                <p className="mt-1 text-[11px] text-ink-400">
                  Assigned {a.assigned_count} {a.assigned_count === 1 ? "time" : "times"}
                  {a.last_assigned_at ? ` · last ${new Date(a.last_assigned_at).toLocaleDateString()}` : ""}
                </p>
              </div>

              <div className="flex shrink-0 gap-1.5">
                <button
                  onClick={() => edit(a)}
                  className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-700 hover:bg-slate-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => toggle(a)}
                  disabled={busy}
                  className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-700 hover:bg-slate-50"
                >
                  {a.active ? "Deactivate" : "Activate"}
                </button>
                <button
                  onClick={() => remove(a)}
                  disabled={busy}
                  className="rounded-lg border border-red-200 px-2.5 py-1.5 text-[11.5px] font-semibold text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
