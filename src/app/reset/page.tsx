import { AuthSplit } from "@/components/auth-split";
import { ResetForm } from "@/components/reset-form";

export const metadata = { title: "Reset your password" };

export default function ResetPage() {
  return (
    <AuthSplit>
      <ResetForm />
    </AuthSplit>
  );
}
