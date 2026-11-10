import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { naira, shortDate } from "@/lib/utils";
import { Card, Badge, EmptyState, Tabs } from "@/components/ui";
import { SellerDecision, SellerSuspend } from "@/components/admin/seller-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sellers" };

export default async function AdminSellersPage({ searchParams }: { searchParams: { tab?: string } }) {
  const tab = searchParams.tab ?? "applications";
  const supabase = createClient();

  const { data: shops } = await supabase
    .from("shops")
    .select("*, order_count:orders(count)")
    .order("created_at", { ascending: false });

  const list = shops ?? [];
  const apps = list.filter((s: any) => s.status === "pending");
  const active = list.filter((s: any) => s.status === "approved");
  const suspended = list.filter((s: any) => s.status === "suspended");

  const shown = tab === "active" ? active : tab === "suspended" ? suspended : apps;

  return (
    <div className="space-y-4">
      <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">Sellers</h1>

      <Tabs
        items={[
          { label: "Applications", href: "/admin-fuckliving/sellers?tab=applications", count: apps.length },
          { label: "Active", href: "/admin-fuckliving/sellers?tab=active", count: active.length },
          { label: "Suspended", href: "/admin-fuckliving/sellers?tab=suspended", count: suspended.length },
        ]}
        current={`/admin-fuckliving/sellers?tab=${tab}`}
      />

      {tab === "applications" ? (
        shown.length === 0 ? (
          <EmptyState icon="📋" title="No applications waiting" body="New seller applications appear here with their NIN/CAC, bank details and uploaded documents." />
        ) : (
          <div className="space-y-3">
            {shown.map((s: any) => (
              <Card key={s.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold text-ink-900">{s.name}</p>
                    <p className="text-[12px] text-ink-500">
                      {s.category} · {s.city}, {s.state} · applied {shortDate(s.created_at)}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge tone="amber">pending</Badge>
                      <Badge tone={s.subscription_status === "pending" ? "blue" : "gray"}>sub: {s.subscription_status}</Badge>
                      <Badge tone="gray">{s.kind}</Badge>
                    </div>
                  </div>
                  <SellerDecision shopId={s.id} />
                </div>

                <dl className="mt-3 grid gap-2 text-[12px] sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <dt className="text-[10.5px] uppercase tracking-wide text-ink-400">NIN / CAC</dt>
                    <dd className="mt-0.5 font-mono font-semibold text-ink-900">{s.nin_or_cac ?? "— not provided"}</dd>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <dt className="text-[10.5px] uppercase tracking-wide text-ink-400">Bank</dt>
                    <dd className="mt-0.5 font-semibold text-ink-900">
                      {s.bank_name} · {s.bank_account_number}
                      <span className="block text-[11px] font-normal text-ink-500">{s.bank_account_name}</span>
                    </dd>
                  </div>
                </dl>

                {s.documents?.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {s.documents.map((d: string) => (
                      <a key={d} href={d} target="_blank" rel="noreferrer" className="h-14 w-14 overflow-hidden rounded-lg border border-[var(--line)]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={d} alt="document" className="h-full w-full object-cover" />
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[11.5px] text-amber-700">No documents uploaded — request more info.</p>
                )}

                {s.description && <p className="mt-2 text-[12.5px] leading-relaxed text-ink-600">{s.description}</p>}
              </Card>
            ))}
          </div>
        )
      ) : (
        <Card className="overflow-hidden">
          {shown.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={tab === "active" ? "🏪" : "⛔"}
                title={tab === "active" ? "No approved sellers yet" : "No suspended sellers"}
                body={tab === "active" ? "Approve an application and it appears here, live in the marketplace." : "Suspending a seller hides their listings immediately."}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-ink-400">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Shop</th>
                    <th className="px-2 py-2 font-semibold">City</th>
                    <th className="px-2 py-2 font-semibold">Category</th>
                    <th className="px-2 py-2 font-semibold">Subscription</th>
                    <th className="px-2 py-2 font-semibold">Delivery</th>
                    <th className="px-4 py-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {shown.map((s: any) => (
                    <tr key={s.id}>
                      <td className="px-4 py-2">
                        <Link href={`/shop/${s.slug}`} className="font-semibold text-ink-900 hover:text-brand-600">{s.name}</Link>
                        {s.verified && <span className="ml-1 text-brand-600">✓</span>}
                      </td>
                      <td className="px-2 py-2 text-ink-600">{s.city}</td>
                      <td className="px-2 py-2 text-ink-600">{s.category}</td>
                      <td className="px-2 py-2">
                        <Badge tone={s.subscription_status === "active" ? "green" : s.subscription_status === "pending" ? "amber" : "red"}>
                          {s.subscription_status}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-ink-600">{naira(s.delivery_fee)}</td>
                      <td className="px-4 py-2"><SellerSuspend shopId={s.id} status={s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
