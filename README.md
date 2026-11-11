# NaijaMart

A Nigerian marketplace for **goods and services** with **admin-held escrow** and **manual bank transfer** payments.

- **Stack:** Next.js 14 (App Router) · TypeScript · Tailwind CSS · Supabase (Auth + Postgres + Storage)
- **Brand:** white, emerald `#0B8A3E`, rounded cards, soft shadows, mobile-first
- **Admin panel:** `/admin-fuckliving` (changeable — see [Changing the admin path](#changing-the-admin-path))

---

## 1. Quick start

```bash
npm install
cp .env.local.example .env.local     # optional — see the note below
npm run dev                          # http://localhost:3000
```

`.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://ecejkevdfpzfvwfjjqwc.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_nTmbEq4kh7viHqVFiSxtmw_m7Yh5-QI
```

> **These two variables are optional.** `src/lib/supabase/config.ts` carries the same values as a
> literal fallback, so the app builds and runs correctly even on a host with no environment
> variables configured. Setting them overrides the fallback. See
> [§1b Why the Supabase config has a fallback](#1b-why-the-supabase-config-has-a-fallback).

---

## 1b. Why the Supabase config has a fallback

This is the fix for the production `500 MIDDLEWARE_INVOCATION_FAILED` that took the whole site
down. Worth understanding before changing anything in `src/lib/supabase/`.

**What happened.** Next.js inlines `process.env.NEXT_PUBLIC_*` at **build** time. The Vercel
project had no `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` set, so the Edge
middleware bundle was compiled with `undefined` for both. `createServerClient(undefined, undefined)`
throws:

```
Your project's URL and Key are required to create a Supabase client!
```

Because middleware runs in front of **every** route, that single throw returned 500 for the entire
site — including pages that never touch Supabase. Static assets (`/_next/static/...`) still served
200, which is the tell-tale signature of a middleware-only failure.

**The fix, in two parts:**

1. **`src/lib/supabase/config.ts`** — a single module that resolves the URL and key with a literal
   fallback. Every client (`client.ts`, `server.ts`, `middleware.ts`, `/api/jobs/run`) imports from
   it, so the values are always present in the bundle regardless of host configuration.
2. **`src/lib/supabase/middleware.ts`** — the session refresh is wrapped in `try/catch`. Middleware
   sits in front of everything, so an unhandled throw there is a site-wide outage. A failed refresh
   now degrades to "anonymous visitor" and logs, instead of killing the request.

**Verifying it.** Build with the variables deliberately unset — the bundle must still contain the
URL and key:

```bash
rm -f .env.local && rm -rf .next && npm run build
grep -c "ecejkevdfpzfvwfjjqwc" .next/server/src/middleware.js   # must be >= 1
```

If that count is `0`, the middleware will throw in production. Also confirm the routes answer
without a 500:

```bash
npx next start -p 3200
for p in / /signin /search /orders; do curl -s -o /dev/null -w "$p %{http_code}\n" localhost:3200$p; done
```

`/orders` and `/seller` correctly return **307** (redirect to sign-in) when signed out — that is
success, not a failure. A **500** on any of them means the middleware is throwing again.

---

## 1a. Supabase (backend) — the **solo proud** project

> **Agents: use the `solo proud` Supabase project.** This is the project the whole backend
> (auth, database, storage, RPCs and the scheduled job) is wired to. Do not create or switch to
> another project.

| Setting | Value |
|---|---|
| Project name | **solo proud** |
| Project id / ref | `ecejkevdfpzfvwfjjqwc` |
| API URL | `https://ecejkevdfpzfvwfjjqwc.supabase.co` |
| Publishable (anon) key | `sb_publishable_nTmbEq4kh7viHqVFiSxtmw_m7Yh5-QI` |
| Storage bucket | `naijamart` (public) |
| Scheduled job | `naijamart-timers` → `select public.run_order_timers()` every 15 min (pg_cron) |

**What is already live on this project** (applied and verified):

- **Database** — all 19 NaijaMart tables, indexes, triggers and the 11 seeded categories
  (`sql/0001_schema.sql`).
- **Auth** — email signup sends a **confirmation link** (the project uses the stock Supabase
  template, which renders `{{ .ConfirmationURL }}`, not a code). The `handle_new_user()` trigger
  auto-creates a profile on signup. Google OAuth is wired end to end in the app but the provider
  is **not enabled** on this project, so the UI hides the Google button until it is — see §1c.
- **Redirect URLs** — `site_url` is set to the deployed origin and the allow-list covers it plus
  `localhost:3000`, so confirmation links and OAuth callbacks land back in the app.
- **Row Level Security** — policies on every table plus the `is_admin()`, `owns_shop()`,
  `can_see_order()`, `can_see_chat()` helpers and the guard triggers (`sql/0002_rls.sql`).
- **Business-rule RPCs** — `place_order`, `admin_verify_payment`, `confirm_delivery`,
  `request_payout`, `run_order_timers`, … (`sql/0003_functions.sql`).
- **Storage** — the public `naijamart` bucket with its object policies (`sql/0006_storage.sql`).
- **Seed data** — 4 demo shops, 6 listings, seller scores and the sample order `NM-8F3K2A`
  (`sql/0005_seed.sql`).
- **Scheduled job** — `run_order_timers()` is scheduled with pg_cron every 15 minutes.

The buyer/seller app runs on the **publishable (anon) key + RLS only** — the anon key is safe to
expose in the browser by design. The **admin console** is the one exception: it reads through a
server-side service-role client (`src/lib/supabase/admin.ts`, `server-only`) so it can work
without a login. That key must never reach the browser — see §3.

Production build:

```bash
npm run build && npm start
```

> Two `next.config.mjs` settings (`experimental.cpus: 1`, `workerThreads: false`) keep `next build`
> inside a 2 GB sandbox. Remove them on a normal machine if you prefer the default worker pool.

---

## 1c. Auth: Google button visibility & the email-link flow

Both rules below exist because the UI was promising something the project could not deliver. Worth
reading before touching `src/components/google-button.tsx` or `src/components/signup/verify-email.tsx`.

### Why the Google button is hidden, not just broken-on-click

`supabase.auth.signInWithOAuth({ provider: "google" })` **does not validate the provider**. It builds
`${SUPABASE_URL}/auth/v1/authorize?provider=google` and **navigates the browser there**. With the
provider disabled, that URL answers with a JSON body and the browser renders it as a page:

```
GET https://<ref>.supabase.co/auth/v1/authorize?provider=google
HTTP/2 400
content-type: application/json
x-sb-error-code: validation_failed

{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}
```

The tab has already left the app, so the `if (error)` branch a naive implementation relies on
**never runs**. The user is stranded on raw JSON. The only reliable fix is to ask the project what
it supports *before* rendering a button:

```
GET https://<ref>.supabase.co/auth/v1/settings   # public, CORS-enabled
→ { "external": { "email": true, "google": false, ... } }
```

`src/lib/supabase/auth-providers.ts` does that once per page load. `src/components/google-button.tsx`
then renders three states:

| Provider state | UI |
|---|---|
| `google: true` | Divider + working **Continue with Google** |
| `google: false` | No button; a one-line note: *"Email sign-in only for now — Google sign-in isn't enabled on this project."* |
| settings call failed | Treated as `false` (fails closed — hides a button rather than sending the user to JSON) |

**To turn Google on**, no code change is needed: enable the provider in Supabase and the button
reappears on the next load. Full steps in §5.

### Why the sign-up screen describes a link, not a code

> **⚠️ Current state: email confirmation is DISABLED (`mailer_autoconfirm: true`).**
> Signup now returns a live session and the user is signed straight in — no email is sent, and
> `/signup/verify` is never reached. This was changed because the project's SMTP credentials were
> rejected by Resend (`535 Authentication credentials invalid`), which made **every** signup fail
> with `500 Error sending confirmation email` and created **no user at all**. See §1e.
>
> The section below still applies if you re-enable confirmation once SMTP works.

The project's **Confirm signup** template is the friendly NaijaMart one, kept in the repo at
[`docs/email-templates/confirm-signup.html`](docs/email-templates/confirm-signup.html). It is a
short, warm welcome - a greeting, one line telling the user to click the button to verify, and a
sign-off - wrapped in a table-based, inline-styled HTML shell that renders well in Gmail and on
mobile. It still uses `{{ .ConfirmationURL }}` as the only variable.

**To apply it:** Supabase dashboard -> Authentication -> Emails -> Templates -> **Confirm signup**,
paste the whole file into the "Message body (HTML)" box, and Save. (The Management API exposes no
email-template endpoint, so this one step is done in the dashboard.)

It contains `{{ .ConfirmationURL }}` and **no `{{ .Token }}`** — so the email holds a link and no
code. A 6-digit input box therefore asks the user to type something that was never sent. `verify-email.tsx`
now states that a confirmation link was emailed, and `emailRedirectTo` points at `/auth/callback` so
clicking it signs the user in and lands them in the app (sellers → `/seller/onboarding`).

**If you'd rather use a code**, do both of these together or the mismatch returns:

1. Supabase → Authentication → Email Templates → **Confirm signup**: add `{{ .Token }}` to print the
   code (e.g. `<p>Your code is <strong>{{ .Token }}</strong></p>`).
2. Switch `verify-email.tsx` back to a code input calling
   `supabase.auth.verifyOtp({ email, token, type: "signup" })`.

### Redirect URLs (already configured)

| Auth setting | Value |
|---|---|
| `site_url` | `https://naijamart-marketplace-opal.vercel.app` |
| `uri_allow_list` | `https://naijamart-marketplace-opal.vercel.app/**`, `…/auth/callback`, `http://localhost:3000/**`, `http://localhost:3000/auth/callback` |

`site_url` was previously `http://localhost:3000` with an **empty** allow-list, which silently broke
every confirmation link and OAuth callback on the deployed domain. When you add a custom domain, add
it to both (or `/auth/callback` will bounce to the wrong origin).

`/auth/callback` also sanitises `next` (rejecting `//evil.com` and absolute URLs) and converts
Supabase's `?error_description=` into `?error=google_disabled|expired|auth`, which the sign-in page
turns into friendly copy.

---

## 1d. ⚠️ The service-role key is hardcoded in this repository

**`src/lib/supabase/admin.ts` contains a real, working Supabase service-role key in source control.**

```ts
const FALLBACK_SERVICE_ROLE_KEY = "sb_secret_…";   // committed on purpose
```

This was a deliberate, accepted trade-off: it lets the admin console work on a deployment with
**no environment variables configured at all**, so `/admin-fuckliving` shows real data out of the
box instead of an empty dashboard.

### What that means

> 🔴 **This repository MUST stay private.**
>
> A service-role key bypasses every RLS policy. Anyone who can read this repo can read every
> buyer's orders, addresses and payout details, and can write to the database as an admin.
> If the repo is ever made public, or the key is pasted into a chat, issue, log or screenshot,
> **rotate it immediately** (Supabase → Project Settings → API Keys) and update the constant.

The repo is currently **private**. Do not flip it to public while this key is in the tree.

### How the key is resolved

| Order | Source | Notes |
|---|---|---|
| 1 | `SUPABASE_SERVICE_ROLE_KEY` env var | Preferred. Lets a deployment override or rotate the key **without a code change**. |
| 2 | `FALLBACK_SERVICE_ROLE_KEY` (committed) | Used when the env var is unset or blank. |

So rotating the key in Vercel alone is enough to neutralise the committed one — set the new value
as `SUPABASE_SERVICE_ROLE_KEY` and the hardcoded fallback is never used.

### Why it still cannot leak to the browser

- The module imports **`server-only`**, so any import from a Client Component is a **compile
  error**, not a runtime leak.
- The constant is **not** prefixed `NEXT_PUBLIC_`, so Next.js never inlines it into the client
  bundle. Only `NEXT_PUBLIC_*` values are inlined.
- All 11 importers are Server Components or Server Actions (`(console)/*`, `actions.ts`).
- Every admin mutation runs as a Server Action; the browser never calls Supabase directly for
  admin work.

### If you want to remove the hardcoded key later

1. Set `SUPABASE_SERVICE_ROLE_KEY` in Vercel (and `.env.local`).
2. Delete the `FALLBACK_SERVICE_ROLE_KEY` constant and change the resolution to
   `process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""`.
3. Rotate the old key in Supabase, since it remains in git history.

---

## 1e. Signup: why it was failing, and the LGA dataset

### The signup bug — a broken mailer, not a broken form

Every signup failed with a red box reading:

```
Error sending confirmation email
```

**Root cause:** the project's SMTP credentials were rejected by Resend. Verified directly against
`smtp.resend.com:465`:

```
220 Resend SMTP Relay ESMTP
334 VXNlcm5hbWU6
334 UGFzc3dvcmQ6
535 Authentication credentials invalid
```

Because `mailer_autoconfirm` was `false`, Supabase tried to send a confirmation email *during*
`auth.signUp`. The send failed, so the whole request returned **HTTP 500** — and critically,
**no user row was created**. Signup was completely blocked, not merely noisy.

**The fix:** `mailer_autoconfirm` is now **`true`**. Signup returns a live session immediately, so
no email is needed and the broken mailer is out of the critical path. Verified end to end:

| Step | Result |
|---|---|
| `POST /auth/v1/signup` | **200**, `email_confirmed_at` set, session returned |
| `profiles` row (via `handle_new_user` trigger) | created — name, phone, state, city, role all persisted |
| `POST /auth/v1/token?grant_type=password` | **200**, access token issued |

`signup-details.tsx` now branches on `data.session`: when auto-confirm is on it routes straight to
`postAuthDestination()` (sellers → `/seller`, buyers → `/`) instead of the "check your email" screen,
which would have been a dead end. A mailer failure is also translated into a human message rather
than a raw 500.

**To re-enable email confirmation** (only after SMTP works): fix the Resend API key in
Supabase → Authentication → Emails → SMTP Settings, send a test, then set
`mailer_autoconfirm: false`. The link flow in §1c is still intact.

### The LGA dataset — 774, not 44

The "City / LGA" dropdown was driven by a hand-written stub in `utils.ts` covering **8 states and
~44 LGAs**. Every other state produced an **empty** dropdown, and even the covered states were
incomplete (Ogun had 8 of 20, Lagos 8 of 20). A seller in Benue could not state where they were.

The data now lives in **`src/lib/nigeria.ts`**: all **774 LGAs across 36 states + the FCT**
(768 LGAs + 6 FCT area councils), matching INEC's published per-state counts exactly.

`utils.ts` re-exports it, so all five existing consumers — signup, seller onboarding, profile,
`/profile/location`, and the listing form — picked up the full list with no per-file changes.

**`npm test`** (→ `scripts/check-lga.mjs`) guards it. It transpiles the real module with the
TypeScript compiler already in `devDependencies`, so there is exactly one copy of the data, and
asserts: total is 774, every per-state count matches INEC, no duplicates or blank names, every
state key round-trips, and `isValidLocation` accepts real pairs and rejects bogus ones.

Verified in a real headless Chromium against a production build:

| State | LGAs in dropdown |
|---|---|
| Ogun | 20 (was 8) |
| Oyo | 33 (was 5) |
| Lagos | 20 (was 8) |
| Kano | 44 |
| Benue | 23 (was **empty**) |
| FCT | 6 |
| Bayelsa | 8 |

Two upstream spellings were normalised: `DanDume` → `Dandume` (Katsina), and the FCT's `Abuja`
area council → `Abuja Municipal (AMAC)`.

---

## 2. The SQL you must apply

Run these **in order** in the Supabase dashboard → **SQL Editor**. Each file is idempotent-ish:
re-running is safe for the schema and seed, and `create or replace` covers the functions.

| # | File | What it creates |
|---|------|-----------------|
| 1 | `sql/0001_schema.sql` | 19 tables, indexes, the `updated_at` trigger, `handle_new_user()` (auto-creates a profile on signup), the rating trigger, and the 11 seeded categories |
| 2 | `sql/0002_rls.sql` | `is_admin()`, `owns_shop()`, `can_see_order()`, `can_see_chat()`, guard triggers, and **RLS policies on every table** |
| 3 | `sql/0003_functions.sql` | Every business rule as a `security definer` RPC: `place_order`, `submit_receipt`, `admin_verify_payment`, `seller_accept_order`, `seller_decline_order`, `seller_advance_order`, `confirm_delivery`, `leave_review`, `raise_dispute`, `admin_resolve_dispute`, `request_payout`, `admin_mark_payout_paid`, `admin_set_shop_status`, `accept_offer`, `start_chat`, plus `run_order_timers()` |
| 4 | `sql/0004_admin_helpers.sql` | Safety net / guard rail — **do not** define a second `public.is_admin()` (see the note in the file) |
| 5 | `sql/0005_seed.sql` | Demo shops, listings, seller scores and one sample order. **Safe to re-run.** |
| 6 | `sql/0006_storage.sql` | Creates the public `naijamart` storage bucket + its object policies |

### Verify it worked

```sql
select count(*) from categories;   -- 11
select slug, status from shops;    -- 4 demo shops, all approved
select reference, total, commission_amount, payout_amount from orders;  -- NM-8F3K2A / 10500 / 525 / 9975
```

**These migrations have been applied to the `solo proud` Supabase project** (`ecejkevdfpzfvwfjjqwc`)
and verified: 19 tables, the RLS policies, every RPC, the `naijamart` storage bucket and the seed
data are all live. The migration set was also executed against a **local PostgreSQL 15 with a
Supabase shim** (`sql/_local_supabase_shim.sql` provides `auth.users`, `auth.uid()`, `storage.*`,
and the `anon`/`authenticated` roles) as a regression check. All six files apply with zero errors,
and `sql/_business_rules_check.sql` asserts the escrow logic. Latest run:

```
PASS  buyer places order in own city
PASS  new order is pending_payment
PASS  total = 16500 (items + delivery)
PASS  5% commission split: commission 825.00 / payout 15675.00
PASS  money starts held in escrow
PASS  non-admin cannot verify a payment
PASS  admin verify → paid, 24h accept clock set
PASS  seller accepts
PASS  seller advances processing → shipped
PASS  only the buyer can confirm delivery
PASS  buyer confirms delivery
PASS  delivery releases escrow to the seller
PASS  a queued payout row was created
PASS  payout locks for 24h after delivery
PASS  payout blocked inside the 24h lock
PASS  seller can request payout once unlocked
PASS  admin marks payout paid → payout + order agree
PASS  buyer leaves a review
PASS  duplicate review rejected
PASS  shop rating recalculated after review
---- ALL BUSINESS RULES PASS ----
```

Reproduce locally with any PostgreSQL 15:

```bash
createdb nmtest
psql -d nmtest -f sql/_local_supabase_shim.sql   # local only — never on Supabase
psql -d nmtest -f sql/0001_schema.sql
psql -d nmtest -f sql/0002_rls.sql
psql -d nmtest -f sql/0003_functions.sql
psql -d nmtest -f sql/0004_admin_helpers.sql
psql -d nmtest -f sql/0005_seed.sql
psql -d nmtest -f sql/_business_rules_check.sql
```

That check already earned its keep: it caught four real bugs before delivery — a `null` violating
`shops.free_delivery_threshold`, `text[]` being written into a `jsonb` column, a **duplicate
`is_admin()` definition that would have broken every admin action at runtime**, and two client-side
RPC argument mismatches (now fixed in `receipt-review.tsx` and `seller-actions.tsx`).

---

## 3. The admin console — no login

**`/admin-fuckliving` loads directly.** There is no admin sign-in page, no sign-up page and no
redirect: every admin URL (orders, payouts, disputes, payments, sellers, buyers, reviews,
settings) renders straight away. This is a deliberate product decision — a single-operator back
office behind an obscure path — not an oversight.

### How it reads the database without a session

Every admin-relevant RLS policy is gated on `is_admin()`, and an anonymous request is not an
admin. Rather than weaken those policies (which would expose every buyer's orders, addresses and
payout details to anyone holding the public anon key), the console talks to the database through
the **service-role key**, which bypasses RLS:

- `src/lib/supabase/admin.ts` — the server-only client. It imports `server-only`, so any
  accidental import from a Client Component is a **compile error** rather than a leaked key.
- `src/app/admin-fuckliving/actions.ts` — every mutation (verify payment, mark payout paid,
  resolve dispute, approve/suspend shop, ban buyer, moderate review, save settings, manage
  categories) is a **Server Action**. The browser never sees the key and never calls Supabase
  directly for admin work.
- The key comes from `SUPABASE_SERVICE_ROLE_KEY` when set, and otherwise falls back to a
  **committed** key in `admin.ts` — see **§1d**. The repository must therefore stay private.

### Optional environment variable (there is a committed fallback)

```bash
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # optional; server-side only, never NEXT_PUBLIC_
```

**You do not need to set this.** `admin.ts` ships a working fallback (§1d), which is why the console
shows real data on a deployment with no environment variables at all. Setting it in
**Vercel → Settings → Environment Variables** (and `.env.local` for local dev) is still the preferred
way to run it, because it lets you rotate the key without a code change — the committed fallback is
ignored whenever the env var is present. Find the value in Supabase → Project Settings → API Keys.

**With no key at all** (env var unset *and* the fallback removed) the console still renders — it
falls back to the anon key (already public) and shows an amber banner: *"Admin database access is
not configured."* Pages load but return no rows and no admin action can be saved. That is
intentional: a missing key should look like a configuration problem, not like "no orders yet".

> ⚠️ **This means the admin console is open to anyone who knows the URL.** That is the trade-off
> that was asked for. If you later want it locked down, the cleanest path is to re-add a session
> check in `src/app/admin-fuckliving/(console)/layout.tsx` and keep the service-role client for
> the reads — the data layer does not need to change.

### Adding admins to `admin_users`

`admin_users` is still the source of truth for `is_admin()` (used by RLS on the buyer/seller side
and by the SQL helpers). Add people by hand:

```sql
insert into public.admin_users (user_id, email)
select id, email from auth.users where email = 'you@example.com';
```

`claim_first_admin()` (`sql/0007_admin_bootstrap.sql`) is still deployed and still safe — it
promotes the caller only while `admin_users` is empty — but nothing in the UI calls it any more,
since there is no admin sign-up page.

### Changing the admin path

It is the folder name, nothing else:

```bash
git mv "src/app/admin-fuckliving" "src/app/<your-new-path>"
grep -rl "admin-fuckliving" src/ | xargs sed -i 's|admin-fuckliving|<your-new-path>|g'
```

(`Tabs`/`AdminNav` build links from the `BASE` constant in `src/components/admin/admin-nav.tsx`;
the rest are per-page `href`s.)

---

## 4. Business rules — where they live

| Rule | Where | Notes |
|---|---|---|
| **5% commission on every order, services included** | `place_order()` | Rate is read from `platform_settings.commission_rate` and **stored on the order**, so changing the rate never rewrites history |
| **Escrow: buyer → admin → seller** | `place_order` → `admin_verify_payment` → `confirm_delivery` | Money only moves to `released` on buyer confirmation (or admin dispute resolution) |
| **Admin verifies the receipt, not the seller** | `admin_verify_payment(p_payment_id, p_approve, p_reason)` | Sets `status='paid'` and stamps `auto_cancel_at = now() + 24h` |
| **Seller must accept within 24h or it auto-cancels** | `auto_cancel_at` + `run_order_timers()` | `seller_accept_order` / `seller_decline_order` (decline is **not** a cancellation — it cancels + restocks + logs a reason) |
| **Confirm delivery starts a 24–48h payout clock** | `confirm_delivery()` | Creates a `payouts` row with `available_at = now() + 24h`; `request_payout` refuses anything before that |
| **Auto-confirm after 7 days** | `auto_confirm_at` + `run_order_timers()` | Stamped when the order ships / is ready for pickup |
| **Buyers browse any city, order only in their own** | `place_order()` | Compares `profiles.city` with `shops.city` and raises a plain-English error |
| **Sellers list free; first ₦5,000 deducted from first payout** | `admin_verify_payment()` (subscription branch) + `first_payment_deducted` | If the shop has never paid, the first verified payout has the subscription taken out |
| **Monthly renewal; listings auto-hide when it lapses** | `expire_subscriptions()` / listing status | Expiry flips `listings.status` to `hidden` |
| **New sellers get a 30-day ranking boost** | `seller_scores.new_seller_boost_until` | Fields are collected from day one; ranking itself is deliberately simple |
| **Every reject needs a reason and notifies** | `admin_verify_payment`, `admin_set_shop_status`, `seller_decline_order` | Reason is written to `reject_reason` / `review_note` / `decline_reason` and surfaced in the UI |

### Scheduled jobs (already scheduled)

`run_order_timers()` does auto-cancel, auto-confirm, release and expiry in one pass. It is
**scheduled on the `solo proud` project** with pg_cron, every 15 minutes:

```sql
select cron.schedule('naijamart-timers', '*/15 * * * *', $$select public.run_order_timers()$$);
```

Check it with:

```sql
select jobid, schedule, jobname, active from cron.job;   -- naijamart-timers / */15 * * * * / true
```

**Or** drive it from any external scheduler every 15 minutes via the app route (no service key
needed — it uses the anon key and a shared secret):

```
POST https://<your-app-domain>/api/jobs/run
x-jobs-secret: <JOBS_SECRET>
```

`vercel.json` is deliberately **not** used for this. A `*/15` cron would be rejected on a Vercel
Hobby plan (Hobby allows only once-per-day schedules) and a rejected `vercel.json` can block a
deployment. The timers are already covered by pg_cron on the `solo proud` project, so this route is
only needed if you want to drive them from an external scheduler instead.

> **`JOBS_SECRET` is required for this route.** Without it the route returns
> `500 {"ok":false,"error":"JOBS_SECRET is not configured on the server."}` — by design, so it can
> never be triggered anonymously.

You can also call the RPC directly from a trusted server:

```
POST https://ecejkevdfpzfvwfjjqwc.supabase.co/rest/v1/rpc/run_order_timers
apikey: <service role key>       # server-side only
```

---

## 5. What still needs the service-role key or manual setup

| Item | Why | What to do |
|---|---|---|
| **Applying the SQL** | ✅ Done on `solo proud` | Already applied — re-run the six files in the SQL editor only if you reset the project (§2) |
| **Vercel env vars** | The two `NEXT_PUBLIC_*` vars are optional (built-in fallback, §1b); `SUPABASE_SERVICE_ROLE_KEY` is now optional too (§1d); only `JOBS_SECRET` is genuinely required | Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, **`JOBS_SECRET`** and **`SUPABASE_SERVICE_ROLE_KEY`** in Vercel → Settings → Environment Variables. `JOBS_SECRET` is required for `/api/jobs/run`. `SUPABASE_SERVICE_ROLE_KEY` is **optional** — the admin console has a committed fallback (§1d) — but setting it lets you rotate the key without a code change. |
| **`run_order_timers` schedule** | ✅ Done on `solo proud` | Scheduled with pg_cron every 15 min (§4) |
| **Google sign-in** | **Not enabled** on `solo proud` — `external_google_enabled: false` and both client id/secret are `null`. There are no Google OAuth credentials in this repo, so it cannot be switched on from code. | The app now **detects this at runtime** (`GET /auth/v1/settings`) and hides the Google button, showing *"Email sign-in only for now — Google sign-in isn't enabled on this project."* instead of walking the user into a JSON error page (§1c). To enable it: create an OAuth client in Google Cloud Console with the authorised redirect URI `https://ecejkevdfpzfvwfjjqwc.supabase.co/auth/v1/callback`, paste the Client ID + Secret into Supabase → Authentication → Providers → Google, toggle it on. **No code change is needed** — the button reappears on the next page load. |
| **Email verification link** | Email signup **is** enabled and sends a **confirmation link**, not a code | Works out of the box; `/signup/verify` now describes a link and the UI no longer asks for a 6-digit code (§1c). For testing, Supabase's default mailer is rate-limited (~4/hour) — add your own SMTP under Auth → Email for real volume. To switch to a *code* instead, put `{{ .Token }}` in the Confirm-signup template and follow the note in §1c. |
| **Bank details** | Set to **SmartCash** | Admin → Settings → Escrow bank account. Currently `SmartCash · 9111356510 · Anifowose Mutiu Ayinde` (also the default in `platform_settings` and `sql/0001_schema.sql`) |
| **Email / WhatsApp notifications on reject** | No mail or WhatsApp provider is connected | Every reject reason is stored and shown in-app (order detail, seller settings, subscription page). Add Resend/Termii + a server action if you want it pushed out. |
| **Sales tax / receipts automation** | Out of scope | — |

---

## 6. Routes

**Public / buyer**

| Route | Notes |
|---|---|
| `/` | Home: location chip, search, categories, verified sellers near you, new in Abeokuta, popular services |
| `/search` | Filters: category, price, city, rating, delivery/pickup, verified only + sort |
| `/listing/[id]` | Gallery, price, shop card, delivery block, qty, add to cart / buy now / chat, reviews |
| `/shop/[slug]` | Shareable public shop page — **browsing is open**, sign-in prompt appears only on buy/chat |
| `/cart` | Grouped by shop, per-shop delivery/pickup, free-delivery progress, consolidation nudge |
| `/checkout` | Address, per-shop method, escrow bank details + `NM-XXXXXX` reference, receipt upload |
| `/orders`, `/orders/[id]` | Status tabs, timeline, ledger, chat, confirm delivery, raise issue, review |
| `/chats`, `/chats/[id]` | Conversation list, pinned order context, image sharing, offers, confirm pickup |
| `/profile`, `/profile/location` | Avatar upload/replace, details, saved addresses, receipts, become a seller, log out |
| `/signup` → `/signup/details` → `/signup/verify` | Role choice → details → 6-digit code |
| `/signin` | Show/hide password, inline validation, Google |

**Seller** — `/seller` (dashboard), `/seller/orders`, `/seller/listings` (+`/new`, `/[id]`),
`/seller/chats`, `/seller/payouts`, `/seller/subscription`, `/seller/reviews`, `/seller/settings`,
`/seller/onboarding?step=1..4`

**Admin** — `/admin-fuckliving` and `/payments`, `/sellers`, `/buyers`, `/orders`, `/disputes`,
`/payouts`, `/reviews`, `/settings`

---

## 7. Demo data, and how to make it yours

`0005_seed.sql` creates:

- **TechHub Abeokuta** (Electronics, ⭐4.8) — Wireless Earbuds Pro ₦8,000, Phone Case ₦2,000
- **Kuto Fabrics** (Fashion, ⭐4.6) — Ankara Material ₦4,000, Aso-oke Head Tie ₦6,500
- **Emeka Plumbing Services** (Home Services, ⭐4.7) — Plumber home service ₦15,000
- **Mama Nkechi Foods** (Food & Groceries, ⭐4.4) — Palm Oil 5L ₦9,500
- One paid sample order `NM-8F3K2A` (₦10,500 gross, ₦525 commission, ₦9,975 net, held)

These shops have `owner_id = null` and `is_demo = true`, so **no seller account can edit them** —
they exist purely so no page is empty. To hand one to a real account:

```sql
update public.shops
   set owner_id = (select id from auth.users where email = 'seller@example.com'),
       is_demo = false
 where slug = 'techhub-abeokuta';
```

### A quick self-check before you deploy

TypeScript cannot see a wrong column name — `.select("count, typo")` compiles and only fails at
runtime. `scripts/check-columns.py` diffs every query in `src/` against `sql/0001_schema.sql`:

```bash
python3 scripts/check-columns.py     # 19 tables checked — 0 column mismatch(es)
```

Run it after any schema or query change; it exits non-zero on a mismatch.

The sample order has `buyer_id = null`, so it is visible to the shop owner and admins but to no
buyer. Give it to a test buyer with:

```sql
update public.orders
   set buyer_id = (select id from auth.users where email = 'buyer@example.com')
 where reference = 'NM-8F3K2A';
```

### End-to-end walkthrough (5 minutes)

1. Sign up as **I want to buy / hire** → verify the code → you land on `/`.
2. Open a listing → **Add to cart** → `/cart` → **Proceed to checkout** → copy the reference,
   upload any image as the receipt → **I have paid**.
3. Promote yourself to admin (§3). In `/admin-fuckliving/payments` hit **Verify**.
4. Now sign up a second account as **I want to sell / offer services** → complete onboarding
   (shop details → verification → billing receipt) → approve the application in
   `/admin-fuckliving/sellers`.
5. As the seller: **Accept order** → **Mark as shipped**.
6. As the buyer: **Confirm delivery** → the payout queues with a 24h lock.
7. As the seller: `/seller/payouts` shows it locked. Backdate it to test withdrawal:
   `update payouts set available_at = now() - interval '1 hour';` → **Request payout**.
8. As the admin: `/admin-fuckliving/payouts` → **Mark as paid**.

---

## 8. Project layout

```
sql/                       migrations + local shim + business-rule test
src/app/
  (shop)/                  buyer routes, shares the tab-bar layout
  seller/                  seller hub (own header + sub-nav)
  admin-fuckliving/        admin panel
  signup/, signin/         auth flow
  auth/callback/           OAuth + email-link handler
src/components/
  ui.tsx                   Card, Badge, Stat, Alert, Tabs, Star, EmptyState, OrderStatusChip…
  cards.tsx                listing / shop / service cards
  seller/, admin/          feature components
src/lib/
  supabase/{client,server,middleware}.ts
  queries.ts               typed read helpers
  cart.ts                  localStorage cart + per-shop grouping maths
  utils.ts                 naira, dates, Nigerian states/LGAs, order status map
src/middleware.ts          session refresh on every request
```

### Notes on correctness

- **RLS is the security boundary**, not the UI. `profiles`, `shops`, `listings`, `orders`,
  `order_items`, `chats`, `messages`, `offers`, `payments`, `payouts`, `reviews`, `disputes`,
  `enquiries`, `addresses`, `shop_followers`, `seller_scores` all have policies. Buyers see their
  own orders/chats; sellers see their own shop's data; `admin_users` members see everything.
- **Guard triggers** stop a non-admin from changing `profiles.role`, `profiles.is_banned`,
  `shops.status`, `shops.verified`, `shops.subscription_status` — so a seller cannot self-approve.
- **Money is integer-safe**: `numeric(12,2)` everywhere, `rounded` commission, and the split is
  computed once and stored on the order.
- `profiles_public` and a `banned` flag back the admin buyer list; the public view exists so a
  buyer name can appear on a shop page without leaking phone numbers.

---

## 9. Known gaps (deliberate, in this iteration)

- `run_order_timers` needs a scheduler (§4). Without it, no auto-cancel/auto-confirm.
- "Follow" is stored (`shop_followers`) but there is no follower feed yet.
- Service offers work end to end (quote → chat → offer → accept → order) but there is no
  per-offer deposit; a service order is created at `pending_payment` like any other.
- Search is `ilike`-based, not Postgres full-text — fine at demo scale.
- No push notifications; chat is polling, not Realtime.
