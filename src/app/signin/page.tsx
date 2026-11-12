import { Suspense } from "react";
import { AuthSplit } from "@/components/auth-split";
import { SignInForm } from "@/components/signin-form";
import { SignInVideo } from "@/components/signin-video";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <AuthSplit>
      {/* The video sits above the form, as the brief asks: video, then
          email, then password, then the sign-up link. */}
      <div className="mb-4">
        <SignInVideo />
      </div>
      <Suspense fallback={<div className="h-80 nm-skeleton rounded-2xl" />}>
        <SignInForm />
      </Suspense>
    </AuthSplit>
  );
}
