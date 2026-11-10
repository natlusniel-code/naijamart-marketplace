import { Suspense } from "react";
import { AuthSplit } from "@/components/auth-split";
import { SignInForm } from "@/components/signin-form";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <AuthSplit>
      <Suspense fallback={<div className="h-80 nm-skeleton rounded-2xl" />}>
        <SignInForm />
      </Suspense>
    </AuthSplit>
  );
}
