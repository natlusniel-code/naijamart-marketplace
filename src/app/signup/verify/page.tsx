import Link from "next/link";
import { Logo } from "@/components/ui";
import { VerifyEmail } from "@/components/signup/verify-email";

export const metadata = { title: "Confirm your account" };

export default function VerifyPage({
  searchParams,
}: {
  searchParams: { email?: string; role?: string; code?: string };
}) {
  const email = searchParams.email ?? "";
  const role = searchParams.role ?? "buyer";
  const code = searchParams.code ?? "";

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <div className="px-4 py-4">
        <Logo />
      </div>
      <div className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-16">
        <VerifyEmail email={email} role={role} initialCode={code} />
      </div>
      <div className="px-4 pb-8 text-center text-[11.5px] text-ink-400">
        By continuing you agree to our{" "}
        <Link href="/legal/terms" className="underline">Terms</Link> and{" "}
        <Link href="/legal/refunds" className="underline">Refund Policy</Link>.
      </div>
    </div>
  );
}
