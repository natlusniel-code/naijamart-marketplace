import { AuthSplit } from "@/components/auth-split";
import { RoleChoice } from "@/components/signup/role-choice";

export const metadata = { title: "Create your account" };

export default function SignupPage() {
  return (
    <AuthSplit>
      <RoleChoice />
    </AuthSplit>
  );
}
