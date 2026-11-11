import { createAdminClient } from "@/lib/supabase/admin";
import { Card, Badge, Stat } from "@/components/ui";
import { BroadcastForm } from "@/components/admin/broadcast-form";
import { relTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

/**
 * Admin → general notifications.
 *
 * Shows the audience sizes up front so an operator knows how many people a
 * send will reach before they commit to it, and a history of past broadcasts
 * grouped by `broadcast_id` so the same announcement is one line, not one line
 * per recipient.
 */
export default async function AdminNotificationsPage() {
  const supabase = createAdminClient();

  const [{ data: profiles }, { data: shops }, { data: recent }] = await Promise.all([
    supabase.from("profiles").select("id,is_banned"),
    supabase.from("shops").select("owner_id").not("owner_id", "is", null),
    supabase
      .from("notifications")
      .select("id,title,body,broadcast_id,created_at")
      .eq("kind", "broadcast")
      .order("created_at", { ascending: false })
      .limit(400),
  ]);

  const sellerIds = new Set((shops ?? []).map((s: { owner_id: string }) => s.owner_id).filter(Boolean));
  const active = (profiles ?? []).filter((p: { is_banned: boolean }) => !p.is_banned);
  const buyerCount = active.filter((p: { id: string }) => !sellerIds.has(p.id)).length;
  const sellerCount = sellerIds.size;
  const everyoneCount = active.length;

  // Collapse the per-recipient rows back into one entry per send.
  const byBroadcast = new Map<
    string,
    { title: string; body: string | null; created_at: string; recipients: number }
  >();
  for (const r of (recent ?? []) as {
    id: string;
    title: string;
    body: string | null;
    broadcast_id: string | null;
    created_at: string;
  }[]) {
    const key = r.broadcast_id ?? r.id;
    const existing = byBroadcast.get(key);
    if (existing) existing.recipients += 1;
    else byBroadcast.set(key, { title: r.title, body: r.body, created_at: r.created_at, recipients: 1 });
  }
  const history = Array.from(byBroadcast.values()).slice(0, 12);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">Notifications</h1>
        <Badge tone="violet">general announcements</Badge>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Buyers" value={String(buyerCount)} />
        <Stat label="Sellers" value={String(sellerCount)} />
        <Stat label="Everyone" value={String(everyoneCount)} />
      </div>

      <BroadcastForm />

      <Card className="p-4">
        <p className="text-[14px] font-bold text-ink-900">Recent announcements</p>
        {history.length === 0 ? (
          <p className="mt-1.5 text-[12.5px] text-ink-500">
            Nothing sent yet. Announcements you send appear here with how many people received them.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {history.map((h, i) => (
              <li key={`${h.created_at}-${i}`} className="py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-semibold text-ink-900">{h.title}</p>
                  <span className="shrink-0 text-[11px] text-ink-400">{relTime(h.created_at)}</span>
                </div>
                {h.body && <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-ink-500">{h.body}</p>}
                <p className="mt-1 text-[11px] text-ink-400">
                  {h.recipients} {h.recipients === 1 ? "recipient" : "recipients"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="pb-2 text-[11.5px] leading-relaxed text-ink-400">
        Order updates are sent automatically and are not listed here — this page is only for announcements you write.
        A person who has turned on browser notifications also gets these on their phone.
      </p>
    </div>
  );
}
