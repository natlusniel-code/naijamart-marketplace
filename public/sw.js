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
 * Deliberately no caching / offline logic: this worker exists for
 * notifications only, and a half-done cache is worse than none.
 */

self.addEventListener("install", () => {
  // Take over as soon as possible so the first notification is not missed.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** Show a notification, tolerating a payload that is missing fields. */
function show(payload) {
  const title = payload.title || "NaijaMart";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // A tag collapses repeats: two "order shipped" pushes for the same order
    // replace each other instead of stacking up.
    tag: payload.tag || undefined,
    renotify: !!payload.tag,
    data: { url: payload.url || "/notifications" },
    vibrate: [80, 40, 80],
  };
  return self.registration.showNotification(title, options);
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A push with a plain-text body is still worth showing.
    payload = { title: "NaijaMart", body: event.data ? event.data.text() : "" };
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
