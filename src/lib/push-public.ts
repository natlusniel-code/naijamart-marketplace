/**
 * The VAPID public key, shared by the browser and the server.
 *
 * A VAPID public key is NOT a secret — it is handed to every browser that
 * subscribes, by design. It is declared here with a literal fallback for the
 * same reason `src/lib/supabase/config.ts` does: Next.js inlines
 * `NEXT_PUBLIC_*` at BUILD time, so a host without the variable would compile
 * `undefined` into the client bundle and every subscription attempt would
 * fail with "no application server key".
 *
 * Setting `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in the host still overrides this.
 */
export const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ||
  "BH4KhHlwe6K-edmJnCgCddFa4Y0I5CzXOD-w7S3OzhoRXXoRYPeY4KNCY0kaiby_2TnqZOddzPEkozCyaDb5nG0";
