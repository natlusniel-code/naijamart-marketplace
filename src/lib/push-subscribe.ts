"use client";

import { createClient } from "@/lib/supabase/client";
import { registerServiceWorker, subscribeToPush } from "@/lib/browser-notify";
import { VAPID_PUBLIC_KEY } from "@/lib/push-public";

/**
 * Make sure THIS device is registered for background push.
 *
 * Permission and subscription are two different things. A user who granted
 * permission on an earlier visit (or on another page) has no subscription row
 * unless something created one — which is exactly why `push_subscriptions`
 * was empty and nothing ever pushed. This runs on every signed-in page load:
 * if permission is already granted it silently (re)creates the subscription
 * and upserts it, so a device that granted permission at any point becomes
 * reachable.
 *
 * It never prompts. Asking for permission requires a user gesture, so that
 * stays in the button; this only acts on permission that already exists.
 *
 * Returns true when this device now has a stored subscription.
 */
export async function ensurePushSubscription(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return false;
  if (Notification.permission !== "granted") return false;

  const reg = await registerServiceWorker();
  if (!reg) return false;

  const sub = await subscribeToPush(VAPID_PUBLIC_KEY);
  if (!sub.ok || !sub.subscription) return false;

  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return false;

  const { error } = await supabase.from("push_subscriptions").upsert(
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

  return !error;
}
