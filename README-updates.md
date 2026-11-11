
---

# NaijaMart — one account, one role

Fixes the reported bug: **a buyer who had become a seller was still being sent
to the storefront on sign-in**, and the account `sultananifowose@gmail.com`
existed as a buyer while owning an approved shop.

| # | Update | Where |
|---|---|---|
| 1 | Opening a shop promotes its owner to `seller`, atomically | `sql/0014`, `onboarding-flow.tsx` |
| 2 | A shop owner can never be stored as a buyer | `sql/0014` (`tg_profiles_guard`) |
| 3 | Existing contradictory rows repaired | `sql/0014` (backfill) |
| 4 | One shared "who is a seller?" rule used by every entry point | `src/lib/roles.ts`, `post-auth.ts`, `auth/callback`, seller hub layout |

---

## Apply it

Run the migration **after the existing ones**:

```bash
# in the Supabase SQL editor, or: supabase db push
sql/0014_one_account_one_role.sql
```

`0014` is idempotent — running it twice is safe.

Then:

```bash
npm install     # no new dependencies were added
npm run build
```

---

## What was actually wrong

There is **no separate buyer database and seller database**. `public.profiles`
is the single account table and `role` is the discriminator
(`'buyer' | 'seller' | 'admin'`). A buyer and a seller are the same row with a
different `role` value — so "move the account from the buyer side to the seller
side" means exactly one thing: flip `role` on that one row. One record, one
role, no second entry anywhere.

The onboarding flow never did that flip. `onboarding-flow.tsx` inserted the
`shops` row in step 1 and stopped there — nothing ever wrote
`profiles.role = 'seller'`. That left a row which was a buyer by `role` while
owning an approved shop with live listings:

```
profiles.role = 'buyer'   +   shops.owner_id = that user
```

Every routing decision that trusted `role` sent the account to the storefront
(right for a buyer, wrong for this account), and every decision that trusted
shop ownership sent it into the Seller Hub and its seller-only settings page
(right for a seller, wrong for a buyer). The two signals disagreed because the
write was missing.

## What the fix does

**1. The transition is atomic and cannot be skipped.** A trigger on `shops`
(`t_shops_promote_owner`, `AFTER INSERT OR UPDATE OF owner_id`) promotes the
owner in the same transaction as the shop write. There is no window where the
shop exists and the role does not.

**2. The contradiction cannot be re-created.** `tg_profiles_guard` now refuses
to store a profile that owns a shop as a `buyer` — whoever is writing. Every
existing rule is kept: the service-role bypass, buyer ↔ seller self-service,
and admin/ban fields staying locked.

**3. Existing rows are repaired.** The backfill promotes every profile that
owns a shop but was still stored as a buyer. It only ever moves
buyer → seller, never touches admins, and is idempotent.

**4. The app has one shared rule.** `src/lib/roles.ts` exports
`isSellerAccount` / `isBuyerAccount`: a seller is an account with
`role = 'seller'` (or an admin) **or** one that owns a shop. `postAuthDestination`,
`/auth/callback` and the seller hub layout all use it, so a stale role read can
never strand a real seller on the storefront, and a genuine buyer — who owns no
shop by definition — is always kept out of the Seller Hub.

**5. The RPC is safe to expose.** `promote_shop_owner_to_seller(uuid)` is
`SECURITY DEFINER` and therefore reachable through PostgREST, so it carries two
guards: a caller may only promote **themselves** (the service role and admins
may promote anyone), and the target must actually **own a shop**. The trigger
calls a separate internal function, because it fires with the seller's own
identity and must not apply the "only yourself" rule.

## What is deliberately NOT deleted

Buyer-side history is kept: `addresses`, `wishlists`, and orders where this
user is the `buyer_id`. Those are past transactions, not a duplicate account —
deleting them would destroy order history and break the seller's own receipts.
"No leftover buyer entry" is satisfied by there being exactly one `profiles`
row with `role = 'seller'`; there is no second row to remove.

## Verify it worked

```sql
-- Expect zero rows: no shop owner is stored as a buyer.
select p.id, p.email, p.role
  from public.profiles p
 where p.role = 'buyer'
   and exists (select 1 from public.shops s where s.owner_id = p.id);

-- Expect one row per account: one record, one role.
select id, count(*) from public.profiles group by id having count(*) > 1;
```

Verified on the live project (`ecejkevdfpzfvwfjjqwc`):

- `sultananifowose@gmail.com` is now `seller` (it owns *Anifowose Furniture*,
  approved, with 2 listings and 1 seller order — and 0 buyer activity).
- Creating a shop as an ordinary signed-in user promotes the owner in the same
  transaction.
- A demotion attempt by the shop owner is silently corrected back to `seller`.
- A buyer with no shop cannot promote themselves, and cannot promote anyone
  else (`42501 not allowed`).
- End-to-end in a real browser: the buyer test account signs in and lands on
  `/`; opening `/seller/settings` bounces to `/`; a seller test account signs in
  and lands on `/seller`, and `/seller/settings` renders normally.
