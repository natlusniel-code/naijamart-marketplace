# NaijaMart — category filter, tag search, ranked storefront

Fixes the three reported bugs. The database does the filtering, matching and
ranking; the app calls it.

| # | Bug | Fix | Where |
|---|---|---|---|
| 1 | Clicking a category showed **every** product | Filter on `listings.category_id`, not on the embedded `categories.slug` | `sql/0015`, `queries.ts` |
| 2 | Searching "washing machine" said the item was not listed | Seller tags + weighted full-text search over title/tags/description | `sql/0015`, `listing-form.tsx` |
| 3 | Page one never changed | Four-bucket round-robin, re-seeded daily | `sql/0015`, `page.tsx` |

---

## Apply it

Run the migration **after** the existing ones:

```bash
# Supabase SQL editor, or: supabase db push
sql/0015_tags_search_ranking.sql
```

`0015` is idempotent — running it twice is safe. It backfills
`search_vector` for existing listings, so search works on the current
catalogue immediately; existing listings simply have no tags until a seller
edits them.

Then:

```bash
npm install     # no new dependencies
npm run build
```

---

## What was actually wrong

### 1. Category filtering

```ts
// before — filters the JOINED rows, not the listing
if (opts.category) query = query.eq("categories.slug", opts.category);
```

PostgREST applies that predicate to the embedded `categories` resource. The
parent listing is never filtered, so every live listing came back and the
non-matching ones merely carried `categories: null`. The storefront rendered
them all — which is exactly what was reported.

The fix resolves the slug to an id in SQL and filters `listings.category_id`
directly. An unknown slug now returns **nothing** rather than everything.

### 2. Search

```ts
// before — one substring, one column
if (opts.q) query = query.ilike("title", `%${opts.q}%`);
```

A listing titled "LG 7kg Front Load Washer" could never match "washing
machine". Now:

- sellers add up to **20 tags** per listing (products *and* services);
- a weighted `tsvector` covers title (A), tags (A) and description (B);
- queries are prefix-AND (`washing:* & machine:*`), so "wash" still hits;
- a substring fallback over title and tags catches what full-text misses.

### 3. Ranking and rotation

Results were `order by created_at desc` — newest won, always. Now
`search_listing_ids` scores on relevance, a 3-day freshness window, shop
rating and real units sold, plus a daily-seeded jitter. `storefront_feed`
interleaves four buckets round-robin:

- **new** — listed in the last 3 days
- **rated** — 4.0+ with at least one review
- **selling** — most units actually sold
- **popular** — most viewed

The seed is the date, so the order is stable within a day and different
tomorrow. A listing appears at most once even if it qualifies for several
buckets.

---

## Tests

`scripts/sql-tests-0015.sql` runs 23 behavioural assertions against a real
Postgres, including the two reported bugs by name:

```bash
createdb nmtest
psql -d nmtest -f scripts/harness-0015.sql
psql -d nmtest -f sql/0001_schema.sql
psql -d nmtest -f sql/0013_discounts_wishlist_notifications.sql
psql -d nmtest -f sql/0015_tags_search_ranking.sql
psql -d nmtest -v ON_ERROR_STOP=1 -f scripts/sql-tests-0015.sql
```

Covers: tag normalisation, the 20-tag cap (rejected, not silently truncated),
"washing machine" → the washer, prefix match, "blue sofa", nonsense → empty,
category isolation with no leakage, unknown category → empty, category+query
composition, city/type filters, relevance beating recency, price sort,
sales counting (and cancelled orders *not* counting), feed balance, no
duplicates, seed rotation, seed stability, and suspended shops staying
invisible.

---

## Notes

- `listings.tags` is `text[] not null default '{}'` with a `<= 20` check
  constraint. The trigger lowercases, trims, collapses whitespace and
  de-duplicates — but deliberately does **not** truncate, so a 21st tag is a
  visible error rather than silent data loss.
- `listing_sales` counts only `delivered`/`completed` orders, so a seller
  cannot rank up by placing and abandoning their own orders.
- Both RPCs are `security invoker`, so RLS on `listings` and `shops` still
  applies.
