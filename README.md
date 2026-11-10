# NaijaMart

A Nigerian marketplace for **goods and services** with **admin-held escrow** and **manual bank transfer** payments.

- **Stack:** Next.js 14 (App Router) · TypeScript · Tailwind CSS · Supabase (Auth + Postgres + Storage)
- **Brand:** white, emerald `#0B8A3E`, rounded cards, soft shadows, mobile-first
- **Admin panel:** `/admin-fuckliving` (changeable — see [Changing the admin path](#changing-the-admin-path))

---

## 1. Quick start

```bash
npm install
cp .env.local.example .env.local     # both values are already public
npm run dev                          # http://localhost:3000
```

`.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://ecejkevdfpzfvwfjjqwc.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_nTmbEq4kh7viHqVFiSxtmw_m7Yh5-QI
```

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
- **Auth** — email signup with a 6-digit code works out of the box; the `handle_new_user()`
  trigger auto-creates a profile on signup. Google OAuth is implemented in the app and starts
  working as soon as the provider is enabled in the dashboard (see §5).
- **Row Level Security** — policies on every table plus the `is_admin()`, `owns_shop()`,
  `can_see_order()`, `can_see_chat()` helpers and the guard triggers (`sql/0002_rls.sql`).
- **Business-rule RPCs** — `place_order`, `admin_verify_payment`, `confirm_delivery`,
  `request_payout`, `run_order_timers`, … (`sql/0003_functions.sql`).
- **Storage** — the public `naijamart` bucket with its object policies (`sql/0006_storage.sql`).
- **Seed data** — 4 demo shops, 6 listings, seller scores and the sample order `NM-8F3K2A`
  (`sql/0005_seed.sql`).
- **Scheduled job** — `run_order_timers()` is scheduled with pg_cron every 15 minutes.

The app runs on the **publishable (anon) key + RLS only** — never put a service-role key in the
client. The anon key is safe to expose in the browser by design.

Production build:

```bash
npm run build && npm start
```

> Two `next.config.mjs` settings (`experimental.cpus: 1`, `workerThreads: false`) keep `next build`
> inside a 2 GB sandbox. Remove them on a normal machine if you prefer the default worker pool.

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

## 3. Make yourself the admin

1. Sign up normally at `/signup` (any role).
2. In the SQL editor:

```sql
insert into public.admin_users (user_id, email)
select id, email from auth.users where email = 'you@example.com';
```

3. Sign out and in again, then open **`/admin-fuckliving`**.

Any account that is not in `admin_users` sees an "Admins only" card — the layout checks on the
server *and* RLS enforces it, so it is not a client-side gate.

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
| **`run_order_timers` schedule** | ✅ Done on `solo proud` | Scheduled with pg_cron every 15 min (§4) |
| **Google sign-in** | Google OAuth is **not enabled** on this Supabase project (the auth settings endpoint returns no external providers) | Supabase → Authentication → Providers → Google: add Client ID/Secret, then add `https://<your-domain>/auth/callback` to *Redirect URLs*. The "Continue with Google" button already calls `signInWithOAuth` and the `/auth/callback` route is implemented — it starts working the moment the provider is switched on. |
| **Email verification code** | Email signup **is** enabled and sends a 6-digit code | Works out of the box. For testing, Supabase's default mailer is rate-limited (~4/hour) — add your own SMTP under Auth → Email for real volume. |
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
