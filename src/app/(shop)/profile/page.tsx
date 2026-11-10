import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { naira, shortDate } from "@/lib/utils";
import { Avatar, Badge, Card } from "@/components/ui";
import { ProfileForm, AvatarEditor } from "@/components/profile-form";
import { SignOutButton } from "@/components/signout";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your profile" };

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/signin?next=%2Fprofile");

  const supabase = createClient();
  const [{ data: addresses }, { data: receipts }, { count: orderCount }] = await Promise.all([
    supabase.from("addresses").select("*").eq("user_id", session.user.id),
    supabase
      .from("payments")
      .select("id,amount,reference,status,receipt_url,created_at,type")
      .eq("type", "order")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("buyer_id", session.user.id),
  ]);

  const p = session.profile;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">Your profile</h1>

      <Card className="p-4">
        <div className="flex items-center gap-4">
          <AvatarEditor avatarUrl={p.avatar_url} name={p.full_name} />
          <div className="min-w-0">
            <p className="truncate text-[16px] font-bold text-ink-900">{p.full_name || "Your name"}</p>
            <p className="truncate text-[12.5px] text-ink-500">{p.email}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone="green">{session.isAdmin ? "Admin" : session.shop ? "Seller" : "Buyer"}</Badge>
              {p.city && <span className="text-[11.5px] text-ink-400">{p.city}, {p.state}</span>}
            </div>
          </div>
        </div>
      </Card>

      <ProfileForm
        initial={{
          full_name: p.full_name,
          phone: p.phone ?? "",
          state: p.state ?? "Ogun",
          city: p.city ?? "Abeokuta South",
        }}
      />

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-[14px] font-bold text-ink-900">Saved addresses</p>
          <Link href="/profile/location" className="text-[12.5px] font-semibold text-brand-600">Manage</Link>
        </div>
        {addresses?.length ? (
          <ul className="mt-2 space-y-2">
            {addresses.map((a: any) => (
              <li key={a.id} className="rounded-xl border border-[var(--line)] px-3 py-2">
                <p className="text-[12.5px] font-semibold text-ink-900">
                  {a.label} {a.is_default && <Badge tone="green" className="ml-1">default</Badge>}
                </p>
                <p className="text-[12px] text-ink-500">{a.line1}, {a.city} {a.state}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[12.5px] text-ink-500">No saved addresses yet — add one at checkout.</p>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-[14px] font-bold text-ink-900">Payment receipts</p>
          <Link href="/orders" className="text-[12.5px] font-semibold text-brand-600">All orders ({orderCount ?? 0})</Link>
        </div>
        {receipts?.length ? (
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {receipts.map((r: any) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-mono text-[11.5px] text-ink-500">{r.reference}</p>
                  <p className="text-[12px] text-ink-400">{shortDate(r.created_at)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[12.5px] font-bold text-ink-900">{naira(r.amount)}</span>
                  <Badge tone={r.status === "verified" ? "green" : r.status === "rejected" ? "red" : "amber"}>
                    {r.status === "verified" ? "Verified" : r.status === "rejected" ? "Rejected" : "Checking"}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[12.5px] text-ink-500">
            Nothing here yet. Once you upload a transfer receipt it appears here.
          </p>
        )}
      </Card>

      <Card className="divide-y divide-[var(--line)] overflow-hidden">
        {!session.shop && (
          <Link href="/seller/onboarding" className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
            <div>
              <p className="text-[13.5px] font-semibold text-ink-900">Become a seller</p>
              <p className="text-[11.5px] text-ink-500">List products or offer services, free to start</p>
            </div>
            <span className="rounded-lg bg-brand-50 px-2.5 py-1 text-[11.5px] font-bold text-brand-700">₦5,000 / mo</span>
          </Link>
        )}
        {session.shop && (
          <Link href="/seller" className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
            <p className="text-[13.5px] font-semibold text-ink-900">Seller hub</p>
            <span className="text-ink-400">→</span>
          </Link>
        )}
        <Link href="/legal/terms" className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
          <p className="text-[13.5px] font-semibold text-ink-900">Terms &amp; policies</p>
          <span className="text-ink-400">→</span>
        </Link>
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-[13.5px] font-semibold text-ink-900">Notifications</p>
            <p className="text-[11.5px] text-ink-500">Order updates by email are always on</p>
          </div>
          <span className="rounded-full bg-brand-500 px-2 py-1 text-[10.5px] font-bold text-white">ON</span>
        </div>
      </Card>

      <SignOutButton />

      <p className="pb-2 text-center text-[11px] text-ink-400">
        Signed in as {p.email} · NaijaMart holds all payments in escrow.
      </p>
    </div>
  );
}
