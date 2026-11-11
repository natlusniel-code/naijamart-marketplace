/**
 * NaijaMart support contact — ONE source of truth.
 *
 * Every "Contact support" affordance in the app (footer, help page, chat,
 * order pages, seller onboarding, error states) must build its link from
 * here. Before this file the number was duplicated in three places and two
 * of them were a placeholder (`2348012345678`), so tapping "Contact support"
 * opened a WhatsApp chat with a number that does not exist.
 *
 * The number is stored in international format: Nigeria's `234` country
 * code with the leading `0` dropped. `09111356510` → `2349111356510`.
 * `wa.me` only accepts the international form — a local `0911…` number
 * resolves to nothing.
 */
export const SUPPORT_WHATSAPP = "2349111356510";

/** Human-readable form for display: 0911 135 6510 */
export const SUPPORT_WHATSAPP_DISPLAY = "0911 135 6510";

/**
 * Build a wa.me deep link, optionally with a prefilled message.
 *
 * `https://wa.me/2349111356510?text=Hi%20NaijaMart…`
 *
 * The message is optional because WhatsApp opens fine without it; when
 * given it is URL-encoded so spaces, `₦` and newlines survive.
 */
export function supportWhatsAppUrl(message?: string): string {
  const base = `https://wa.me/${SUPPORT_WHATSAPP}`;
  if (!message) return base;
  return `${base}?text=${encodeURIComponent(message)}`;
}

/** The default prefilled line used by generic "Contact support" links. */
export const SUPPORT_DEFAULT_MESSAGE =
  "Hi NaijaMart support, I need help with...";
