import { createAdminClient } from "@/lib/supabase/admin";
import { Card, Badge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Blocked messages" };

/**
 * Admin log of messages the chat guard refused (sql/0011).
 *
 * A blocked message is never delivered — it is written here instead, with
 * the sender, receiver, timestamp, the full text and the rule that fired.
 * Read-only: the log is written only by `send_chat_message()`.
 */
export default async function AdminBlockedMessagesPage() {
  const supabase = createAdminClient();
  const { data: rows } = await supabase
    .from("blocked_messages_admin")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  const items = rows ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">Blocked messages</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-500">
            Messages the chat guard refused. None of these reached the receiver.
          </p>
        </div>
        <Badge tone="gray">{items.length} shown</Badge>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="🛡️"
          title="Nothing blocked yet"
          body="When a message contains restricted contact, payment or external-platform information, it is refused and logged here."
        />
      ) : (
        <div className="space-y-2">
          {items.map((m: any) => (
            <Card key={m.id} className="p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12.5px] font-bold text-ink-900">
                  {m.sender_name ?? "Unknown sender"}
                  <span className="font-normal text-ink-400"> → </span>
                  {m.receiver_name ?? "Unknown receiver"}
                </p>
                <p className="text-[11px] text-ink-400">
                  {new Date(m.created_at).toLocaleString()}
                </p>
              </div>

              <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-slate-50 px-2.5 py-2 text-[12.5px] leading-relaxed text-ink-700">
                {m.body}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge tone="red">{m.rule_group}</Badge>
                <span className="font-mono text-[11px] text-ink-500">{m.rule_pattern}</span>
                {m.matched_text && m.matched_text !== m.rule_pattern && (
                  <span className="text-[11px] text-ink-400">matched “{m.matched_text}”</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
