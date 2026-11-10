import { Suspense } from "react";
import { AuthSplit } from "@/components/auth-split";
import { SignupDetails } from "@/components/signup/signup-details";

export const metadata = { title: "Account details" };

export default function DetailsPage() {
  return (
    <AuthSplit>
      <Suspense fallback={<div className="h-96 nm-skeleton rounded-2xl" />}>
        <SignupDetails initialRole="buyer" />
      </Suspense>
    </AuthSplit>
  );
}
