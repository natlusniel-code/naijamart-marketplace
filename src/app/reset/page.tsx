import { Suspense } from "react";
import { AuthSplit } from "@/components/auth-split";
import { ResetPasswordForm } from "@/components/reset-password-form";

export const metadata = { title: "Reset your password" };

/**
 * `/reset` — the destination of the "Forgot password?" link on the sign-in
 * form. It did not exist before, so that link 404'd and a buyer who forgot
 * their password had no way back into their account.
 *
 * `Suspense` is required because the form reads `useSearchParams()` (for
 * `?mode=update` and `?error=expired`), and Next bails out of static rendering
 * for a client component that does so without a boundary.
 */
export default function ResetPage() {
  return (
    <AuthSplit>
      <Suspense fallback={<div className="h-80 nm-skeleton rounded-2xl" />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthSplit>
  );
}
