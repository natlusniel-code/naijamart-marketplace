/**
 * Where a notification came from, and what it should be called.
 *
 * ── The problem this solves ────────────────────────────────────────────
 * Every push used to arrive with whatever `notifications.title` happened to
 * hold, and the OS showed it with no indication of its origin. A buyer could
 * not tell a message from another person apart from a NaijaMart system
 * announcement or an order update — they all looked like the same app talking.
 *
 * So a notification now carries a SOURCE, and the source decides the title:
 *
 *   chat       → "Message from Ada"        (the sender's name)
 *   order      → "Order update"
 *   broadcast  → "NaijaMart"
 *   system     → "NaijaMart"
 *   promo      → "NaijaMart offer"
 *
 * ── Why the mapping lives here ─────────────────────────────────────────
 * The same rule has to hold in two places: the server that builds the push
 * payload (src/lib/push.ts) and the service worker that may receive a bare
 * payload (public/sw.js). Keeping the table in one TS module and mirroring it
 * in the worker is deliberate — the worker cannot import TypeScript, so the
 * alternative is a build step for a 20-line lookup. `NOTIFICATION_SOURCES`
 * below is the authority; sw.js carries the same table and says so.
 */

export type NotificationKind = "order" | "chat" | "broadcast" | "system" | "promo";

export type NotificationSource = {
  /** The label shown as the notification's title prefix. */
  label: string;
  /** A short line under the title, so the origin is readable at a glance. */
  subtitle: string;
  /** Where tapping it should land when the row has no href of its own. */
  href: string;
};

export const NOTIFICATION_SOURCES: Record<NotificationKind, NotificationSource> = {
  chat: {
    label: "Message",
    subtitle: "New message",
    href: "/chats",
  },
  order: {
    label: "Order update",
    subtitle: "NaijaMart orders",
    href: "/orders",
  },
  broadcast: {
    label: "NaijaMart",
    subtitle: "Announcement",
    href: "/notifications",
  },
  system: {
    label: "NaijaMart",
    subtitle: "Account notice",
    href: "/notifications",
  },
  promo: {
    label: "NaijaMart offer",
    subtitle: "Deals and discounts",
    href: "/notifications",
  },
};

/** Anything unrecognised is treated as a NaijaMart system notice. */
export function sourceFor(kind: string | null | undefined): NotificationSource {
  return NOTIFICATION_SOURCES[(kind ?? "system") as NotificationKind] ?? NOTIFICATION_SOURCES.system;
}

/**
 * Build the title the OS will show.
 *
 * A chat notification is the one case where the sender's name IS the useful
 * title — "Message from Ada" tells the buyer who is talking to them, which is
 * exactly what was asked for. Every other source is named after the source
 * itself, so a system notice never masquerades as a person.
 *
 * `rawTitle` is the row's own title: for chat that is the sender's shop or
 * display name (set by the trigger in sql/0022), for everything else it is
 * the specific subject ("Your order NM-1042 has shipped").
 */
export function notificationTitle(kind: string | null | undefined, rawTitle: string | null | undefined): string {
  const src = sourceFor(kind);
  const subject = (rawTitle ?? "").trim();

  if (kind === "chat") {
    return subject ? `Message from ${subject}` : "New message";
  }

  // A system/broadcast row whose title already starts with the brand would
  // read "NaijaMart — NaijaMart: ..." if we prefixed it blindly.
  if (subject && subject.toLowerCase().startsWith(src.label.toLowerCase())) return subject;

  return subject ? `${src.label} — ${subject}` : src.label;
}

/** The line under the title: names the source, then the detail. */
export function notificationBody(kind: string | null | undefined, rawBody: string | null | undefined): string {
  const src = sourceFor(kind);
  const detail = (rawBody ?? "").trim();
  return detail ? `${src.subtitle} · ${detail}` : src.subtitle;
}
