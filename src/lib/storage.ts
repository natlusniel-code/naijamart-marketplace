/**
 * Normalise stored file references into URLs the admin console can render.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Sellers upload verification images to the `naijamart` storage bucket and we
 * persist the resulting URL in `shops.logo_url` / `shops.documents[]`.
 *
 * The bucket is PUBLIC (verified: the stored public URL returns HTTP 200), so a
 * plain public URL is all the admin page needs — no signing, no service-role
 * call, and this module stays usable from any Server Component.
 *
 * The one wrinkle is that a stored value may be a bare object path
 * (`documents/abc.png`) rather than a full URL, if it was written by an older
 * code path or by hand. `toPublicUrl` normalises both shapes, and leaves
 * external URLs (e.g. the seeded unsplash logos) untouched.
 */
import { SUPABASE_URL } from "./supabase/config";

const BUCKET = "naijamart";

/** Pull the object path out of a Supabase storage URL, or pass a bare path through. */
export function storagePathFrom(value: string): string | null {
  if (!value) return null;
  const marker = "/storage/v1/object/";
  const i = value.indexOf(marker);
  if (i === -1) {
    // A bare path like "documents/abc.png". Absolute URLs to other hosts
    // (the seeded unsplash logos) need no rewriting.
    return /^https?:\/\//i.test(value) ? null : value.replace(/^\/+/, "");
  }
  // .../object/public/naijamart/documents/abc.png
  const rest = value.slice(i + marker.length);
  const parts = rest.split("/");
  // parts[0] = public | sign | authenticated, parts[1] = bucket
  if (parts.length < 3) return null;
  return decodeURIComponent(parts.slice(2).join("/").split("?")[0]);
}

/** Turn a stored reference into a URL the browser can load. */
export function toPublicUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const path = storagePathFrom(value);
  if (!path) return value; // external URL — leave as-is
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

/** Map a list of stored references to displayable URLs. */
export function toPublicUrls(values: (string | null | undefined)[]): string[] {
  return values
    .map((v) => toPublicUrl(v))
    .filter((v): v is string => !!v);
}
