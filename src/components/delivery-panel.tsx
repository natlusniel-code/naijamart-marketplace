"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, uploadToBucket } from "@/lib/supabase/client";
import { naira, relTime } from "@/lib/utils";
import { Spinner, Badge, Alert } from "@/components/ui";

/**
 * The "Deliver Order" tab inside a chat.
 *
 * ── Why this lives in the conversation ────────────────────────────────
 * A service is agreed in chat: the buyer says what they want, the seller
 * quotes, the buyer accepts and pays. The work itself then has to come back
 * through the same thread — otherwise the buyer has to hunt for an order
 * page to find the file they paid for, and the seller has no obvious place
 * to put it.
 *
 * So the thread gets a second tab. The seller uploads the work there; the
 * buyer downloads it and accepts. Accepting is what marks the order
 * delivered, counts the gig's delivery, queues the payout and opens the
 * review — all of it in `buyer_accept_delivery` (sql/0028), so the client
 * cannot get the sequence wrong.
 *
 * ── Why the file list is fetched here, not passed in ──────────────────
 * The chat page is a Server Component and renders before a delivery exists.
 * A seller who uploads while the buyer is looking at the thread must see it
 * appear, so the list is read from the client and refreshed after every
 * write. Realtime would be nicer, but a delivery is a rare event and a
 * refetch on action is enough.
 */

/** Everything the seller may attach. Mirrors the bucket's allowed types. */
const ACCEPT =
  ".pdf,.docx,.doc,.txt,.ppt,.pptx,.png,.jpeg,.jpg,.csv,.webp,.svg,.gif,.heic,.mp3,.wav,.zip,.rar,.psd,.ai,.fig,.html,.css,.js";

type DeliveryFile = {
  id: string;
  kind: "file" | "link";
  url: string;
  name: string | null;
  size_bytes: number | null;
  expires_at: string;
};

type Delivery = {
  id: string;
  note: string | null;
  status: "sent" | "accepted" | "rejected";
  accepted_at: string | null;
  created_at: string;
  delivery_files: DeliveryFile[];
};

function sizeLabel(n: number | null) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function DeliveryPanel({
  orderId,
  amSeller,
  orderStatus,
  promisedAt,
  deliveryDays,
}: {
  orderId: string;
  amSeller: boolean;
  orderStatus: string;
  promisedAt: string | null;
  deliveryDays: number | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Delivery[] | null>(null);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<{ file: File; key: string }[]>([]);
  const [links, setLinks] = useState<string[]>([]);
  const [linkDraft, setLinkDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const input = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("deliveries")
      .select("id,note,status,accepted_at,created_at,delivery_files(id,kind,url,name,size_bytes,expires_at)")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false });
    if (error) {
      setErr(error.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as unknown as Delivery[]);
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const latest = rows?.[0] ?? null;
  const canDeliver = amSeller && ["paid", "accepted", "processing", "shipped", "ready_for_pickup"].includes(orderStatus);
  const canAccept = !amSeller && latest?.status === "sent";

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = Array.from(list).map((file) => ({ file, key: `${file.name}-${file.size}-${Math.random()}` }));
    setFiles((prev) => [...prev, ...next]);
  }

  function addLink() {
    const raw = linkDraft.trim();
    if (!raw) return;
    // A bare "example.com/x" is a link the seller meant; give it a scheme so
    // the anchor works instead of resolving relative to the app.
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setLinks((prev) => [...prev, url]);
    setLinkDraft("");
  }

  async function send() {
    if (!files.length && !links.length && !note.trim()) {
      setErr("Add a file, a link, or a note before sending.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const payload: { kind: string; url: string; name?: string; size?: number }[] = [];

      for (const { file } of files) {
        const url = await uploadToBucket(file, `deliveries/${orderId}`);
        payload.push({ kind: "file", url, name: file.name, size: file.size });
      }
      for (const url of links) payload.push({ kind: "link", url, name: url });

      const supabase = createClient();
      const { error } = await supabase.rpc("seller_send_delivery", {
        p_order_id: orderId,
        p_note: note.trim() || null,
        p_files: payload,
      });
      if (error) throw new Error(error.message);

      setFiles([]);
      setLinks([]);
      setNote("");
      await load();
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Could not send the delivery.");
    }
    setBusy(false);
  }

  async function accept(id: string) {
    setBusy(true);
    setErr("");
    const supabase = createClient();
    const { error } = await supabase.rpc("buyer_accept_delivery", { p_delivery_id: id });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    // Accepting is the end of the job, so the buyer lands on the review
    // rather than being left in the thread wondering what happens next.
    router.push(`/orders/${orderId}?review=1`);
    router.refresh();
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(""), 1600);
    } catch {
      setErr("Could not copy — long-press the link instead.");
    }
  }

  if (rows === null) {
    return <div className="h-40 nm-skeleton rounded-2xl" />;
  }

  return (
    <div className="nm-scroll flex-1 space-y-3 overflow-y-auto py-2">
      {/* the promise */}
      {promisedAt && (
        <div className="rounded-xl border border-brand-500/20 bg-brand-50/70 px-3 py-2">
          <p className="text-[11.5px] font-semibold text-brand-900">
            Promised delivery: {new Date(promisedAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
            {deliveryDays ? ` · ${deliveryDays} day${deliveryDays === 1 ? "" : "s"}` : ""}
          </p>
        </div>
      )}

      {err && <Alert tone="red">{err}</Alert>}

      {/* seller: compose a delivery */}
      {canDeliver && (
        <div className="rounded-2xl border border-[var(--line)] bg-white p-3 shadow-card">
          <p className="text-[13px] font-bold text-ink-900">Deliver this order</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-500">
            Attach the finished work. The buyer can download it and accept — that releases your payment.
          </p>

          <textarea
            rows={2}
            className="nm-input mt-2 resize-none !text-[12.5px]"
            placeholder="A note for the buyer (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          {/* staged files */}
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f) => (
                <li key={f.key} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
                  <span className="text-[13px]">📄</span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-700">{f.file.name}</span>
                  <span className="shrink-0 text-[10.5px] text-ink-400">{sizeLabel(f.file.size)}</span>
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((x) => x.key !== f.key))}
                    className="shrink-0 text-[11px] font-semibold text-ink-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {links.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {links.map((l) => (
                <li key={l} className="flex items-center gap-2 rounded-lg bg-blue-50 px-2 py-1.5">
                  <span className="text-[13px]">🔗</span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-blue-900">{l}</span>
                  <button
                    type="button"
                    onClick={() => setLinks((prev) => prev.filter((x) => x !== l))}
                    className="shrink-0 text-[11px] font-semibold text-blue-700/60 hover:text-red-600"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* the "+" upload button */}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-dashed border-[var(--line)] text-[17px] font-bold text-ink-500 hover:border-brand-400 hover:text-brand-600"
              aria-label="Add files"
            >
              +
            </button>
            <input
              ref={input}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.currentTarget.value = "";
              }}
            />
            <input
              className="nm-input !py-2 !text-[12px]"
              placeholder="…or paste a link"
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLink();
                }
              }}
            />
            <button
              type="button"
              onClick={addLink}
              disabled={!linkDraft.trim()}
              className="shrink-0 rounded-xl border border-[var(--line)] px-2.5 py-2 text-[11.5px] font-semibold text-ink-700 disabled:opacity-40"
            >
              Add
            </button>
          </div>

          <button onClick={send} disabled={busy} className="nm-btn-primary mt-2.5 w-full !py-2.5">
            {busy ? <><Spinner /> Sending…</> : "Send delivery"}
          </button>
          <p className="mt-1.5 text-center text-[10.5px] leading-relaxed text-ink-400">
            Files are removed automatically one week after upload.
          </p>
        </div>
      )}

      {/* buyer: accept */}
      {canAccept && latest && (
        <div className="rounded-2xl border border-brand-500/30 bg-white p-3 shadow-card">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-bold text-ink-900">Your delivery is here</p>
            <Badge tone="amber">Awaiting you</Badge>
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
            Download everything below, then accept. Accepting releases the seller&apos;s payment and opens the review.
          </p>
          <button onClick={() => accept(latest.id)} disabled={busy} className="nm-btn-primary mt-2.5 w-full !py-2.5">
            {busy ? <Spinner /> : "Accept delivery"}
          </button>
        </div>
      )}

      {/* history */}
      {rows.length === 0 ? (
        <div className="mx-auto mt-6 max-w-xs rounded-xl bg-slate-50 px-3 py-3 text-center text-[12px] leading-relaxed text-ink-500">
          {amSeller
            ? "Nothing delivered yet. Attach the finished work above when it is ready."
            : "The seller has not sent a delivery yet. It will appear here when they do."}
        </div>
      ) : (
        rows.map((d) => (
          <div key={d.id} className="rounded-2xl border border-[var(--line)] bg-white p-3 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11.5px] font-bold uppercase tracking-wide text-ink-500">
                Delivery · {relTime(d.created_at)}
              </p>
              <Badge tone={d.status === "accepted" ? "green" : "amber"}>
                {d.status === "accepted" ? "Accepted" : "Sent"}
              </Badge>
            </div>

            {d.note && <p className="mt-1.5 whitespace-pre-line text-[12.5px] leading-relaxed text-ink-700">{d.note}</p>}

            {d.delivery_files.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {d.delivery_files.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
                    <span className="text-[13px]">{f.kind === "link" ? "🔗" : "📄"}</span>
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-brand-700 hover:underline"
                    >
                      {f.name || f.url}
                    </a>
                    {f.size_bytes ? (
                      <span className="shrink-0 text-[10.5px] text-ink-400">{sizeLabel(f.size_bytes)}</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => copy(f.url)}
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-500 hover:bg-white hover:text-brand-700"
                    >
                      {copied === f.url ? "Copied" : "Copy"}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {d.status === "accepted" && d.accepted_at && (
              <p className="mt-2 text-[11px] text-brand-700">
                Accepted {relTime(d.accepted_at)} ·{" "}
                <a href={`/orders/${orderId}?review=1`} className="font-semibold underline">
                  Leave a review
                </a>
              </p>
            )}
          </div>
        ))
      )}
    </div>
  );
}
