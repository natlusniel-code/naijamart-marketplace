"use client";

import { useEffect, useState } from "react";
import {
  enableBrowserNotifications,
  notificationPermission,
  notificationsSupported,
  registerServiceWorker,
  subscribeToPush,
} from "@/lib/browser-notify";
import { createClient } from "@/lib/supabase/client";
import { Alert, Spinner } from "@/components/ui";

type State = "unsupported" | "default" | "granted" | "denied";

/**
 * "Turn on phone notifications" control.
 *
 * The permission prompt must come from a click, so this is a button and never
 * an automatic request on load. It also states what will and will not work,
 * because a buyer who is told "notifications on" and then misses an order
 * because the browser was closed has been misled.
 */
export function PushOptIn() {
  const [state, setState] = useState<State>("default");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [pushNote, setPushNote] = useState("");

  useEffect(() => {
    if (!notificationsSupported()) {
      setState("unsupported");
      return;
    }
    setState(notificationPermission() as State);
    // Register early so the worker is ready the moment permission is granted.
    void registerServiceWorker();
  }, []);

  async function enable() {
    setBusy(true);
    setNote("");
    setPushNote("");
    const res = await enableBrowserNotifications();
    setState(res.permission as State);
    setBusy(false);

    if (!res.ok) {
      setNote(res.error ?? "Notifications were not enabled.");
      return;
    }
    setNote("Notifications are on for this browser.");

    // Store a push subscription if the deployment has a VAPID key. Without
    // one this is a no-op that explains itself rather than failing silently.
    const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const sub = await subscribeToPush(vapid);
    if (sub.ok && sub.subscription) {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (uid) {
        await supabase.from("push_subscriptions").upsert(
          {
            user_id: uid,
            endpoint: sub.subscription.endpoint,
            p256dh: sub.subscription.keys?.p256dh ?? "",
            auth: sub.subscription.keys?.auth ?? "",
            user_agent: navigator.userAgent.slice(0, 200),
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: "endpoint" },
        );
        setPushNote("This device is also registered for background push.");
      }
    } else if (sub.error) {
      setPushNote(sub.error);
    }
  }

  if (state === "unsupported") {
    return (
      <Alert tone="amber" title="This browser can't show notifications">
        Order updates still appear in the list below and in the bell at the top of the page.
      </Alert>
    );
  }

  if (state === "granted") {
    return (
      <Alert tone="green" title="Phone notifications are on">
        You&apos;ll get a notification when an order moves — payment confirmed, shipped, delivered.{" "}
        {pushNote && <span className="opacity-80">{pushNote}</span>}
      </Alert>
    );
  }

  if (state === "denied") {
    return (
      <Alert tone="amber" title="Notifications are blocked for this site">
        Your browser is blocking them. To turn them on, open this site&apos;s settings in your browser (the padlock
        icon in the address bar) and allow notifications, then reload this page.
      </Alert>
    );
  }

  return (
    <div className="rounded-xl border border-brand-500/25 bg-brand-50 px-3.5 py-3">
      <p className="text-[13px] font-semibold text-brand-900">Get order updates on your phone</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-brand-900/80">
        Turn on browser notifications and we&apos;ll tell you the moment your payment is confirmed, your order ships, or
        it&apos;s ready to collect — even when this tab is in the background.
      </p>
      <button onClick={enable} disabled={busy} className="nm-btn-primary mt-2.5 !py-2 !text-[12.5px]">
        {busy ? <><Spinner /> Turning on…</> : "Turn on notifications"}
      </button>
      {note && <p className="mt-2 text-[11.5px] text-brand-900/80">{note}</p>}
    </div>
  );
}
