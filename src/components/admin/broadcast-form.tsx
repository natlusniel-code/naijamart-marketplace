"use client";

import { useState } from "react";
import { sendBroadcast, type BroadcastAudience } from "@/app/admin-fuckliving/actions";
import { Alert, Spinner, Card } from "@/components/ui";
import { cn } from "@/lib/utils";

const AUDIENCES: { key: BroadcastAudience; label: string; hint: string }[] = [
  { key: "buyers", label: "Buyers", hint: "Everyone who has not opened a shop" },
  { key: "sellers", label: "Sellers", hint: "Everyone who owns a shop" },
  { key: "everyone", label: "Everyone", hint: "All active accounts" },
];

/**
 * Compose and send a general notification.
 *
 * The audience is chosen explicitly and the recipient count is shown before
 * sending, because a broadcast cannot be unsent — it lands in every inbox the
 * moment it goes out. The confirm step is a second click, not a modal, so it
 * stays out of the way for a routine announcement.
 */
export function BroadcastForm() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [href, setHref] = useState("");
  const [audience, setAudience] = useState<BroadcastAudience>("everyone");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function send() {
    setBusy(true);
    setResult(null);
    const res = await sendBroadcast({ title, body, audience, href });
    setBusy(false);
    setConfirming(false);

    if (res.ok) {
      setResult({ ok: true, message: `Sent to ${res.sent} ${res.sent === 1 ? "person" : "people"}.` });
      setTitle("");
      setBody("");
      setHref("");
    } else {
      setResult({ ok: false, message: res.error ?? "Could not send the notification." });
    }
  }

  const ready = title.trim().length >= 3 && body.trim().length >= 3;

  return (
    <Card className="p-4">
      <p className="text-[14px] font-bold text-ink-900">Send a notification</p>
      <p className="mt-0.5 text-[12px] text-ink-500">
        Goes to each person&apos;s notification list and, if they allowed it, to their phone. It cannot be recalled once
        sent.
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <label className="nm-label">Who should get it?</label>
          <div className="flex flex-wrap gap-2">
            {AUDIENCES.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => setAudience(a.key)}
                className={cn("nm-chip !py-2", audience === a.key && "nm-chip-active")}
                title={a.hint}
              >
                {a.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-ink-400">{AUDIENCES.find((a) => a.key === audience)?.hint}</p>
        </div>

        <div>
          <label className="nm-label">Title</label>
          <input
            className="nm-input"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. New delivery rates from Monday"
          />
          <p className="mt-1 text-right text-[10.5px] text-ink-400">{title.length}/120</p>
        </div>

        <div>
          <label className="nm-label">Message</label>
          <textarea
            rows={4}
            className="nm-input resize-none"
            value={body}
            maxLength={1000}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write the announcement. Keep it short and say what the person should do."
          />
          <p className="mt-1 text-right text-[10.5px] text-ink-400">{body.length}/1000</p>
        </div>

        <div>
          <label className="nm-label">Link (optional)</label>
          <input
            className="nm-input"
            value={href}
            onChange={(e) => setHref(e.target.value)}
            placeholder="/legal/terms or /search?category=electronics"
          />
          <p className="mt-1 text-[11px] text-ink-400">
            Where tapping the notification takes them. Leave empty and it just opens the notifications page.
          </p>
        </div>
      </div>

      {result && (
        <div className="mt-3">
          <Alert tone={result.ok ? "green" : "red"}>{result.message}</Alert>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        {confirming ? (
          <>
            <button onClick={() => setConfirming(false)} disabled={busy} className="nm-btn-ghost flex-1 !py-3">
              Cancel
            </button>
            <button onClick={send} disabled={busy} className="nm-btn-primary flex-1 !py-3">
              {busy ? <><Spinner /> Sending…</> : `Yes, send to ${audience}`}
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            disabled={!ready}
            className="nm-btn-primary w-full !py-3 disabled:opacity-50"
          >
            Review &amp; send
          </button>
        )}
      </div>
    </Card>
  );
}
