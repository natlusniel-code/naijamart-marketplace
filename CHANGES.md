# Naijamart — Remove Pollinations from the AI listing feature

**Repo:** `natlusniel-code/naijamart-marketplace` · base commit `3f69ae9` (branch `main`)
**Scope:** the AI listing feature only. Nothing else in the app was touched.

## What changed

Pollinations is gone from the codebase entirely — no image generation by
Pollinations anywhere. Gemini now does exactly one job in this feature: it
writes the listing copy **and the six banner prompts**. The six prompts are
shown to the seller in a copyable block with **one "Copy all six prompts"
action**.

### Files changed (3)

| File | Change |
|---|---|
| `src/lib/ai-listing.ts` | Removed the whole Pollinations banner-rendering layer. Added `bannerPromptsToText()`. |
| `src/components/seller/ai-listing-panel.tsx` | Removed all banner image state/UI. Added the copyable six-prompt block. |
| `src/lib/supabase/client.ts` | Dropped the Pollinations mention from the upload comment. |

Diff: **76 insertions, 656 deletions** across 3 files.

### Removed from `src/lib/ai-listing.ts`

- `bannerImageUrl()` — built the `image.pollinations.ai` URL
- `fetchBannerBlob()` — fetched the banner image, read 402/403 status
- `BannerError` class
- `blobToImage()`, `renderBanner()`, `drawBannerText()`, `wrapText()` — the canvas text-over-image pipeline
- `downloadBlob()` — banner download helper
- All `kontext` / rate-limit / `Retry after` handling

### Removed from `ai-listing-panel.tsx`

- `BannerState` type, `banners` / `bannerRun` state, `bannerAbortRef`
- `runBanners()`, `generateOneBanner()`, `regenerateBanner()`
- The `BannerCard` component and the whole banner grid UI
- The `detailLine()` helper (only used to caption banners)

### Added

- `bannerPromptsToText(listing)` in `ai-listing.ts` — joins the six prompts
  into one text block, each prefixed with its slot name, in the brief's order.
- A **"Copy all six prompts"** button in the panel (one action copies all six),
  plus a read-only list of the six prompts with their target size/ratio.

## What was deliberately kept

- **Compulsory product description** — `MIN_DETAILS_CHARS` gate and the
  "(required)" label are unchanged; the button stays locked without it.
- **Multiple product photo upload** — up to 6 photos, JPEG/PNG/WebP, 5 MB each,
  downscaled to 1600px, uploaded to the `naijamart` bucket. Unchanged.
- **All other AI listing features** — listing copy generation, per-field
  Regenerate (title / short / long / tags), Copy all, Use this in my listing,
  draft persistence in `localStorage`, the Gemini primary→fallback model logic,
  and the parallel upload-while-analysing flow.

## Verification

- `npm run typecheck` (`tsc --noEmit`) — **exit 0**
- `npm run build` (`next build`) — **exit 0**, all routes compiled
- `grep -ri pollinations` across the repo — **0 matches**
- `grep` for every removed symbol (`bannerImageUrl`, `fetchBannerBlob`,
  `BannerError`, `renderBanner`, `drawBannerText`, `wrapText`, `downloadBlob`,
  `blobToImage`, `kontext`) — **0 matches**

## How to apply

The three files under `src/` are drop-in replacements. Or apply the patch:

```bash
git apply remove-pollinations.patch
```

## Note (unchanged from the earlier review)

The Gemini API key is still split into two constants and shipped in the client
bundle (`ai-listing.ts`). That is a pre-existing issue outside this task's
scope — the real fix is a server route (`/api/ai-listing`) reading
`process.env.GEMINI_API_KEY`.
