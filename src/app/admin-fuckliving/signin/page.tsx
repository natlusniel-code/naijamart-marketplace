import { Suspense } from "react";
import { AdminAuthShell } from "@/components/admin/admin-auth-shell";
import { AdminSignInForm } from "@/components/admin/admin-signin-form";

export const metadata = { title: "Admin sign in" };

export default function AdminSignInPage() {
  return (
    <AdminAuthShell subtitle="Sign in to manage orders, payouts, sellers and disputes across the whole marketplace.">
      <Suspense fallback={<div className="h-80 nm-skeleton rounded-2xl" />}>
        <AdminSignInForm />
      </Suspense>
    </AdminAuthShell>
  );
}
