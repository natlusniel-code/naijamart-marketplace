# Buyer–seller chat: presence-gated AI, live delivery, typing, status, pinned composer

Base commit: `6d2e5aa` · Branch: `main` · Repo: `natlusniel-code/naijamart-marketplace`

---

## 1. `src/lib/ai-reply.ts` — the AI only speaks while the seller is offline

**Before:** presence chose between two *drafts* — a chattier one when the seller was
online, a shorter one when they were away — and **both were sent**. The AI could
therefore answer a buyer while the seller was sitting in the thread typing their own
reply.

**After:** presence decides whether the AI may speak at all.

| Seller state | Mode | What happens |
|---|---|---|
| Offline (no heartbeat for 3 min) | `auto` | The reply is **sent**, flagged `ai_generated` |
| Online | `suggested` | The draft is **stored only**; nothing is sent |

- `mode !== "auto"` returns early with `reason: "seller_online"` before `send_ai_reply`
  is ever called.
- The check runs **per buyer message**, not once per conversation, so a seller who
  returns mid-thread stops the AI from the next message onward and takes over. No flag
  to reset, no stale state.
- The suggestion row is still written in both modes, so the seller keeps the audit
  trail and can use/edit/dismiss the draft.
- `send_ai_reply`'s result now also handles `{ skipped: true, reason }` — the case where
  the seller came back between the app's check and the insert.

**Premium gate unchanged and still enforced:** `seller_has_feature(shop, 'aiReply')`
is checked before anything else, so a Basic shop gets `reason: "not_in_plan"` and no
reply. `shops.ai_reply_enabled` is still honoured.

---

## 2. `sql/0042_ai_reply_offline_only.sql` — the rule enforced in the database

`send_ai_reply` now refuses to insert while `seller_is_online(shop_id)` is true,
returning `{ blocked: false, skipped: true, reason: 'seller_online' }`.

This is defence in depth, not a duplicate of the app check: the app check decides
*which draft to write*, this one decides *whether the AI may speak at all*. A future
caller that forgets the first check still cannot break the rule.

The refusal is a **return, not an exception** — the buyer's message is already saved,
and a raised error would surface as a broken chat.

Also re-asserts `messages` in the `supabase_realtime` publication, so a database
restored from an older dump still streams live.

---

## 3. `src/components/chat-live.tsx` *(new)* — presence, typing, headline

`useChatPresence()` returns `{ otherOnline, otherTyping, notifyTyping, stopTyping,
clearOtherTyping }`.

**Transport:** one Supabase Realtime channel per thread (`chat-live-{chatId}`) carrying
both **presence** (`track()` on subscribe, `sync` to read who is there) and **broadcast**
(`typing` / `stop-typing`).

**Why not a table:** "is the other person typing" is true for a second and worthless
once stored. A table would mean a row per keystroke burst, a cleanup job, and a stale
"typing…" left by a closed tab. Broadcast forgets it when the socket drops — exactly
the right lifetime.

**What "online" means, per side:**

| Viewer | Other party | Source |
|---|---|---|
| Seller | Buyer | Thread presence only — there is no buyer heartbeat, and inventing one would be a claim we cannot back |
| Buyer | Seller | `seller_is_online()` heartbeat **OR** thread presence |

The two are **OR-ed, never AND-ed**: telling a buyer "Offline" while their seller is
actively replying in the hub would be a lie.

**Typing hygiene:** throttled to one broadcast per 1.5 s; a 4 s TTL clears the dots if
the sender goes quiet without sending (closed tab, lost signal); `self: false` so you
never see your own dots.

`TypingDots` — three dots, one keyframe, staggered by inline `animationDelay`.
`PresenceHeadline` — green dot + "Online", black dot + "Offline"; the dot is
`aria-hidden` and the word carries the meaning, so status is never colour-only.

---

## 4. `src/components/chat-thread.tsx` — wiring

- **Status headline** in the header, beside the existing role label (the label is kept,
  not replaced). Updates live from presence.
- **Typing dots** rendered *outside* the scroll area, between the thread and the
  composer, so they never push the message list or hide behind the composer. Shown for
  the other party composing **and** for the AI while the reply request is in flight
  ("Seller's assistant is typing…").
- **AI dots** are set when the `/api/ai/reply` request leaves and cleared when it
  settles, with a 20 s hard ceiling so they cannot dance forever. They are also cleared
  the instant a message arrives over realtime.
- **Realtime INSERT handler** now calls `clearOtherTyping()` and clears the AI dots —
  a message arriving means nobody is composing any more.
- **Composer typing broadcast** on every keystroke (throttled in the hook); `stopTyping`
  on send and when the box is emptied.
- **Composer pinning** — already `sticky bottom-0`; the keyboard offset now also adds
  `env(safe-area-inset-bottom)` so it clears the home indicator on a notched phone:
  `marginBottom: calc(var(--nm-kb, 0px) + env(safe-area-inset-bottom, 0px))`.
- **AI trigger gated on `aiReplyEnabled`** — a Basic shop's buyer no longer shows
  "assistant is typing" for a reply the endpoint will refuse.
- New props: `otherUserId` (required), `shopId`, `sellerOnlineSeed`.

---

## 5. `src/app/(shop)/chats/[id]/page.tsx` — buyer page

- Reads `seller_is_online(shop_id)` **on the server** and passes it as
  `sellerOnlineSeed`, so the headline is correct on the first paint instead of flashing
  "Offline" until the client polls.
- Reads `shopHasFeature(shop_id, "aiReply")` and passes it as `aiReplyEnabled`, so the
  AI typing dots are gated on the same Premium check the endpoint uses.
- Passes `otherUserId` and `shopId`.

## 6. `src/app/seller/(hub)/chats/[id]/page.tsx` — seller page

- Same `otherUserId` / `shopId` / presence seed.
- **Premium gate tightened:** `aiReplyEnabled` is now
  `shopHasFeature(shop_id, "aiReply") && shops.ai_reply_enabled !== false`.
  Previously it was only the shop's own switch, so a Basic shop that had once enabled
  the feature still saw the suggestion panel. The plan gate is the authority, and it is
  the same `seller_has_feature` call the server-side reply path makes — the panel and
  the endpoint can no longer disagree.

## 7. `src/app/globals.css` — the dots

`@keyframes nm-typing-bounce` + `.nm-typing-dot`. `translateY` and `opacity` only — no
layout, no repaint of the thread behind it. Under `prefers-reduced-motion: reduce` the
dots are still and dimmed; the text label still says "typing".

---

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0**, no output |
| `npm run build` | **exit 0** — "✓ Compiled successfully", 56/56 static pages |
| AI sends while seller **offline** | `mode = "auto"` → `send_ai_reply` called → `sent: true` |
| AI sends while seller **online** | `mode = "suggested"` → early return `reason: "seller_online"` → **no send** |
| Database backstop | `send_ai_reply` returns `skipped` when `seller_is_online` is true |
| Premium restriction | `seller_has_feature(…, 'aiReply')` checked first in `handleBuyerMessage`; `shopHasFeature` gates both pages' UI |

**Not verified by running the app:** the typing dots, presence headline and composer
behaviour are verified by typecheck, build and code reading — not by a live browser
session. The Realtime channel needs `messages` in the publication (sql/0009, re-asserted
in 0042) and Realtime enabled on the Supabase project.

**Migration required:** apply `sql/0042_ai_reply_offline_only.sql` for the database-side
presence guard.
