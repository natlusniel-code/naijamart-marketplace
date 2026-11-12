"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { ensurePushSubscription } from "@/lib/push-subscribe";
import { notificationPermission, showBrowserNotification } from "@/lib/browser-notify";

/**
 * Site-wide notification wiring — mounted once in the ROOT layout, so it
 * covers the storefront, the seller hub and the admin console alike.
 *
 * Two jobs:
 *
 *   1. Register this device for background push. Permission is never
 *      requested here (that needs a click); this only acts on permission
 *      that already exists, which is what turns "granted" into an actual
 *      `push_subscriptions` row the server can send to.
 *
 *   2. Raise an OS notification for a new row while the tab is open. The
 *      server push covers the closed-app case; this covers the open one
 *      without waiting for the next poll, and it is the only path that
 *      works on a browser with no push service.
 *
 * The bell in the header keeps its own subscription for the badge. This one
 * is deliberately separate and role-agnostic: a seller or an admin has no
 * bell on every page, and they still need to be told.
 */
export function NotificationBridge() {
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    const supabase = createClient();

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid || cancelled) return;

      // 1. Make this device reachable by the server.
      void ensurePushSubscription();

      // 2. Live OS notification for a row that arrives while we are open.
      channel = supabase
        .channel("nm-notify-bridge")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
          (payload) => {
            const row = payload.new as {
              id: string;
              title: string;
              body: string | null;
              href: string | null;
            };
            if (notificationPermission() !== "granted") return;
            // The notifications page is where these are read; a popup for a
            // row the user is already looking at is noise.
            if (window.location.pathname.startsWith("/notifications")) return;
            void showBrowserNotification({
              title: row.title,
              body: row.body,
              url: row.href ?? "/notifications",
              tag: row.id,
            });
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return null;
}
