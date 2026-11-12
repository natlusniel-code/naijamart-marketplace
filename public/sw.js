/* NaijaMart service worker — browser notifications.
 *
 * Two jobs, both about getting an order update in front of the buyer when the
 * tab is not open:
 *
 *   1. `push` — a Web Push message from the server. This is the only path that
 *      works with the browser fully closed, and it needs a push subscription
 *      (see src/lib/browser-notify.ts) plus a server that sends to it.
 *
 *   2. `message` — the page telling us "a notification just arrived" while the
 *      tab IS open. This is the fallback that needs no server: the app already
 *      has the row from Realtime, so it hands the text to the worker, which
 *      raises a real OS notification. Without this, an in-app toast is all a
 *      buyer gets, which is exactly what was asked to be improved on.
 *
 * ── Why there is a `fetch` handler that does nothing ──────────────────────
 * Chrome will not treat a site as installable unless its service worker
 * handles `fetch`. This worker has no cache and no offline story, so the
 * handler simply steps aside and lets the network serve every request. It
 * exists to satisfy the installability check, not to intercept anything —
 * adding a real cache here would be a separate, deliberate decision.
 */

self.addEventListener("install", () => {
  // Take over as soon as possible so the first notification is not missed.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Required for installability. No caching: every request goes to the network
 * exactly as it would without a worker. Returning without calling
 * `respondWith` is the correct way to say "not my business".
 */
self.addEventListener("fetch", () => {
  /* network handles it */
});

/**
 * Where a notification came from, and what to call it.
 *
 * This mirrors NOTIFICATION_SOURCES in src/lib/notification-source.ts. The
 * worker cannot import TypeScript, so the table is duplicated here — keep the
 * two in step. The server normally sends an already-built title; this copy is
 * the fallback for a bare payload (a push from another source, or an older
 * server build) so the origin is still named rather than showing a raw string.
 */
const SOURCES = {
  chat: { label: "Message", subtitle: "New message", href: "/chats" },
  order: { label: "Order update", subtitle: "NaijaMart orders", href: "/orders" },
  broadcast: { label: "NaijaMart", subtitle: "Announcement", href: "/notifications" },
  system: { label: "NaijaMart", subtitle: "Account notice", href: "/notifications" },
  promo: { label: "NaijaMart offer", subtitle: "Deals and discounts", href: "/notifications" },
  delivery: { label: "Delivery", subtitle: "NaijaMart delivery", href: "/notifications" },
};

/**
 * One group for the whole app.
 *
 * ── The bug this fixes ────────────────────────────────────────────────
 * Every notification used its own tag (or none), so the phone's notification
 * centre filled with a separate NaijaMart entry per event — five orders meant
 * five rows, and the shade became unreadable. The requirement is that
 * NaijaMart notifications arrive as ONE grouped entry, and opening it shows
 * the rest.
 *
 * Android groups by `tag` when the tag is shared, so every notification now
 * carries the same tag. The body is rewritten to say how many are waiting,
 * and tapping the group opens the notifications page where all of them are
 * listed. `renotify: false` is deliberate: re-alerting on every collapse
 * would buzz the phone once per order, which is the noise we are removing.
 */
const GROUP_TAG = "naijamart";

function sourceFor(kind) {
  return SOURCES[kind] || SOURCES.system;
}

function titleFor(kind, rawTitle) {
  const src = sourceFor(kind);
  const subject = (rawTitle || "").trim();
  if (kind === "chat") return subject ? `Message from ${subject}` : "New message";
  if (subject && subject.toLowerCase().startsWith(src.label.toLowerCase())) return subject;
  return subject ? `${src.label} — ${subject}` : src.label;
}

function bodyFor(kind, rawBody) {
  const src = sourceFor(kind);
  const detail = (rawBody || "").trim();
  return detail ? `${src.subtitle} · ${detail}` : src.subtitle;
}

/** Show a notification, tolerating a payload that is missing fields. */
function show(payload) {
  const kind = payload.kind || "system";
  const src = sourceFor(kind);

  // A payload that already carries a built title (the normal case, from
  // src/lib/push.ts) is used as-is; otherwise the source table names it.
  const title = payload.title || titleFor(kind, payload.subject);
  const body = payload.body || bodyFor(kind, payload.detail);

  return self.registration.getNotifications({ tag: GROUP_TAG }).then((existing) => {
    // Count what is already in the group so the collapsed row can say
    // "3 new updates" instead of only the newest one.
    const count = existing.length + 1;

    const options = {
      body: count > 1 ? `${body} · ${count} new updates` : body,
      // The green cart on a transparent background. The old value was the full
      // app tile, which the OS drew as a white square — the reported bug.
      icon: payload.icon || "/notification-icon-192.png",
      badge: payload.badge || "/notification-icon-96.png",
      // One shared tag = one grouped entry in the shade.
      tag: GROUP_TAG,
      // Do not buzz again when the group collapses; the first alert is enough.
      renotify: false,
      // Tapping the group lands on the list, where every notification is
      // readable — that is the "show more" the requirement asks for.
      data: { url: "/notifications", kind, latest: payload.url || src.href },
      vibrate: [80, 40, 80],
    };
    return self.registration.showNotification(title, options);
  });
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A push with a plain-text body is still worth showing.
    payload = { kind: "system", title: "NaijaMart", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(show(payload));
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "nm:notify") {
    event.waitUntil(show(data.payload || {}));
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/notifications";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // Reuse an open NaijaMart tab if there is one, rather than piling up
      // windows every time a buyer taps a notification.
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
