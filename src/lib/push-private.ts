import "server-only";

/**
 * Committed fallback VAPID PRIVATE key.
 *
 * Why this is committed: the same reason `src/lib/supabase/admin.ts` commits a
 * service-role key. This deployment has no environment variables set, and a
 * feature that silently does nothing until someone opens a dashboard is worse
 * than no feature. Without the private key the server cannot sign a push, so
 * `push_subscriptions` stays empty and "notifications are not pushing" stays
 * true.
 *
 * What that costs: anyone with read access to this repository can sign a push
 * and deliver it to a subscriber of this site. Web Push has no other
 * authenticator. It is narrow — it cannot read data or act as a user, only
 * raise a notification — but the repository must therefore stay PRIVATE (a
 * hard requirement already, because of the service-role key).
 *
 * Preferred: set `VAPID_PRIVATE_KEY` in the host to override this, so the key
 * can be rotated without a code change. Rotating invalidates every existing
 * subscription; devices re-subscribe automatically on next load, because
 * `ensurePushSubscription()` runs on every signed-in page.
 */
export const FALLBACK_VAPID_PRIVATE_KEY =
  "Ske5JxpE7re9ldNGoPHXAPuvVgYARDFy_Iz6njmn0w8";

export const VAPID_SUBJECT_FALLBACK = "mailto:support@naijamart.ng";
