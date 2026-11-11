"use client";

import { useTransition } from "react";
import { signOutAction } from "@/app/auth/actions";
import { Spinner } from "@/components/ui";

/**
 * Sign out.
 *
 * The session is cleared by a Server Action, because the auth cookies are
 * httpOnly and the browser cannot remove them itself. `signOutAction` also
 * redirects, so there is no window where the page is still showing a signed-in
 * header with no session behind it.
 */
export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <button
      onClick={() => startTransition(() => signOutAction())}
      disabled={pending}
      className="nm-btn-ghost w-full !py-3 !text-red-600 hover:!bg-red-50"
    >
      {pending ? <><Spinner /> Logging out…</> : "Log out"}
    </button>
  );
}
