import { redirect } from "next/navigation";

export const metadata = { title: "Terms of Service — NaijaMart" };

/**
 * Several places in the app link to /legal/terms (signup, profile, auth split).
 * The canonical policy document lives at /legal, so this route exists purely to
 * keep those links from 404-ing. It redirects rather than duplicating the text,
 * so there is only ever one copy of the policy to keep up to date.
 */
export default function TermsPage() {
  redirect("/legal");
}
