import { AuthSplit } from "@/components/auth-split";
import { ProfilePhoto } from "@/components/signup/profile-photo";

export const metadata = { title: "Add a profile photo" };

/**
 * Signup step 4 — optional profile photo.
 *
 * `next` is carried through from the verify step so a buyer who was heading
 * somewhere specific (a listing, a chat) still lands there afterwards. It is
 * sanitised to a same-origin relative path, exactly like `safeNext` in
 * `@/app/auth/actions`, so the query string cannot be used as an open redirect.
 */
export default function SignupPhotoPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const raw = searchParams.next ?? "/";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  return (
    <AuthSplit>
      <ProfilePhoto next={next} />
    </AuthSplit>
  );
}
