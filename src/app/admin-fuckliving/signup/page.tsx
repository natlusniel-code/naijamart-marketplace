import { AdminAuthShell } from "@/components/admin/admin-auth-shell";
import { AdminSignUpForm } from "@/components/admin/admin-signup-form";

export const metadata = { title: "Create admin account" };

export default function AdminSignUpPage() {
  return (
    <AdminAuthShell subtitle="Create the marketplace admin account. The first account created here becomes the admin.">
      <AdminSignUpForm />
    </AdminAuthShell>
  );
}
