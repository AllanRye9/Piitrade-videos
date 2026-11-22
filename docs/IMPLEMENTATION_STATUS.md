# GLOBAL_POSITIONING.md — implementation status

**Read this first.** The positioning doc lists a "foundation that already exists" (site registry, `searchSites`, `resolveVideoLink`, `siteUrls.ts`, `seo.ts`, `feedRank.ts`, Admin → Sites, a per-video product link). **None of that was in the codebase provided**, which had one hard-wired marketplace and no product links. The minimum needed foundation was built here (below) rather than the doc's full version.

## Foundation built (not in the provided code)
| Item | Built as |
|---|---|
| Site registry + Admin → Shops | `Site` model, `lib/sites.ts`, `routes/admin/sites.ts`, `ShopsPage` (name, website host, currency/country, commission %, postback secret, active, **Test connection**) |
| Domain restriction for links | `hostMatchesSite` / `validateProducts` — links must be on an active shop's host |
| UTM + click token | `withClickParams` (`utm_*` and `pv_click`) |
| Trending ranking | `lib/feedRank.ts` (the codebase only had a raw-SQL trending; there is no "For you" feed or location boost) |
| Server-rendered permalink + SEO | `/v/:id` with Open Graph, Twitter player, oEmbed discovery and `VideoObject` JSON-LD (`lib/embedPages.ts`) |
| Multi-site parallel search (`searchSites`) | **Not built.** Marketplace search is still the single configured marketplace. |

## Feature 1 — Attribution and payouts: done
`GET /go/:videoId/:productId?` (+ `?url=` for non-pinned links), `POST /api/attribution/click` (app), `POST /api/attribution/conversion` (HMAC-SHA256 over `timestamp.rawBody`, ±5 min, idempotent per `(site, orderId)`, 30-day window, self-referral earns nothing), ledger (`PayoutEntry`, status machine pending→approved→paid/reversed), creator earnings API, admin Attribution + Payouts pages, permissions `sites.*`, `attribution.view`, `payouts.view|manage`, audit-logged status changes, conversion-rate ranking signal. Money is stored in minor units as BIGINT.

**Deviation (security):** the app does not open `/go` in a browser. A session id is a credential and must not appear in a URL, so the app calls `POST /api/attribution/click` (session in a header) and opens the returned URL; if that call fails it falls back to `/go` (pinned products) or the direct link, as specified.

## Feature 2 — Embeds and distribution: mostly done
Done: `/embed/:id` (iframe-able via explicit CSP `frame-ancestors`, muted autoplay, product chips in their windows, no cookies), `/api/oembed`, `/embed.js` widget + `/api/embed/by-product`, open listing spec + validator (`docs/LISTING_SPEC.md`, Test connection), share = permalink, "Share embed code" for creators, deep links (`piitrade://v/<id>` and, when `EXPO_PUBLIC_WEB_URL` is https, App Links/Universal Links via `app.config.js`).

Not done / deviations:
* **Shopify and WooCommerce plugins — not built.** The listing contract they would expose is documented.
* **Per-site embed allow-list** — a single global `EMBED_FRAME_ANCESTORS` setting instead.
* "Copy embed code" uses the system share sheet (`Share`) rather than `expo-clipboard`, to avoid adding a native dependency that I could not install/test for SDK 58.

## Feature 3 — Shoppable moments: done for mobile + admin, partial elsewhere
Done: `VideoProduct` (start/end, optional hotspot, ordering), validation (shop domain, times inside the clip, hotspot 0–1, ≤8 per video), creator endpoints (`GET/PUT /api/videos/:id/products`, `POST …/suggest-products`), products accepted at upload, `products` on every video payload, JSON-LD `about`, admin product editor on the video edit dialog, mobile overlay (chips by time window; memoised so position updates only re-render when the visible set changes; hotspots are placed on the actual picture rectangle, correct for letterboxed videos), mobile tagging sheet (More → "Pin products to this video").

Not done / deviations:
* AI suggestions are **after upload** (`/api/videos/:id/suggest-products`, ≤3 keyframes, ≤3 AI calls per request, heavy-upload rate limit) rather than on the picked clip before upload — the clip is not on the server yet at that point. Requires `AI_SEARCH` and `MARKETPLACE_API`; otherwise it answers 503 and the sheet says so.
* The mobile tagging sheet uses −/+ steppers for the time window (no slider dependency) and does not place hotspots; hotspots are supported by the API and the overlay but there is no UI to position them yet.
* The **web consumer upload modal** has no tagging UI (admin has one).
* "Migrate the legacy single `productUrl`" — there was none in this codebase.

## Saved items (added after the original three features)
Why: the goal is to sell partners' visibility without interrupting viewing. Tapping a product tag used to open a browser (leaving the video); it now **saves the item and the video keeps playing**. The tag turns into "✓ Saved · View list"; tapping it again opens the Saved items list inside the app. From the list the viewer opens the product later through the attribution redirect, so the creator is still credited for the sale.

* Backend: `SavedItem` (snapshot of url/title, unique per viewer+product, survives the creator re-pinning, kept if the video is deleted, removed with its shop), `GET/POST/DELETE /api/saved-items`, cap of 200 per viewer, `saved` flag on feed products, rate-limited. Works for guests (no sign-in prompt — an auth prompt is the interruption this avoids). Items saved as a guest stay with that guest session; signing in to an *existing* account switches session, so those guest items don't follow.
* Partners see **Saves** next to clicks and sales in Admin → Attribution.
* Mobile: tag-tap saves (optimistic, with offline/error messages), `SavedItemsSheet`, entry under Settings → Shopping.
* **Viewing guardrail + partner funnel** (done after Saved items): `docs/GUARDRAIL.md`. Randomized hold-out, aggregated watch-time stats, a verdict with a confidence range and a minimum-data rule, and the tags-shown → saved → opened → sold funnel per shop (Admin → Attribution).
* Not covered: the web embed/widget chips still link out through `/go` (there is no saved list on the web); there is no saved-items badge or reminder notification yet.

## Audit against GLOBAL_POSITIONING.md (instruction by instruction)

**Not done**
* Shopify and WooCommerce plugins (Feature 2).
* A **shop-facing** dashboard. Shops cannot log in; the numbers are in the admin (Attribution, Payouts) only (Feature 1).
* Creator earnings on the **web profile** (Feature 1) — app only.
* Per-shop allow-list for who may embed the player; one global `EMBED_FRAME_ANCESTORS` setting instead (Feature 2).
* Product tagging inside the **upload flow**: mobile `UploadSheet` "Products" step and web `UploadModal` (Feature 3). Mobile tags after upload via More → "Pin products"; the API already accepts `products` at upload but no screen sends them.
* Product tags/overlay in the **web consumer app** (`VideoCard`, types, api) — mobile and admin only (Feature 3, "update both together").
* Hotspot **placement** UI, and the in-video **crop-and-search** fallback on mobile (mobile Find is a text search) (Feature 3).
* Click-tracking text in the **privacy policy** (`PrivacyPage.tsx` does not mention it; only the Earnings sheet has a note), automated **retention** deletion, and cookie/**consent** handling — documented in `docs/ATTRIBUTION.md`, not implemented (Feature 1).
* `mobile/src/state/sites.ts` (the app reads shops straight from `GET /api/marketplace/sites` where it needs them).
* Multi-catalog `searchSites`, a "For you" feed and location boost — the foundation described did not exist in the code provided.
* EAS preview build and on-device testing.

**Done on purpose differently:** the app logs taps with `POST /api/attribution/click` (a session id must not go in a URL) instead of opening `/go`; embed code is shared with the system share sheet (no `expo-clipboard`); AI suggestions run after upload; a tag tap now *saves* the item first (Saved items) and the product opens later through the attribution redirect.

**Everything else in the document is implemented and tested**, including: `/go` redirect with UTM and click token, HMAC-signed idempotent conversion postbacks, the creator ledger and status workflow, admin permissions and audit log, conversion-aware ranking, embed page, oEmbed, shop widget, SEO permalink and JSON-LD, listing spec and Test connection, deep links, `VideoProduct` with time windows and hotspots, validation, admin product editor, and the mobile overlay.

A real-browser check was run against the real routes behind `helmet` (15 assertions): the widget on a different-origin shop page found the right video from the page's product URL and framed the player; chips showed and hid in their time windows (including "until the end"); chip links went through `/go` and produced a 302 with `pv_click`/UTM and a correct click record; the permalink forbids third-party framing while the embed allows it; oEmbed and JSON-LD present; no script errors. (The script is not shipped.)

## Verification
Backend: `tsc` clean; 137 tests, including an HTTP-level flow (click → redirect → signed postback → replay → tamper → expiry → self-referral) against an in-memory database. Schema validated with Prisma's own parser; **all migrations applied on a real PostgreSQL engine (PGlite)** and the new constraints exercised (idempotent order id, restricted shop delete, click survives video delete, product cascade, single primary admin). Mobile: `tsc` clean; pure product logic tested under Node. Admin UI: built and screenshotted.

**Not verified:** the mobile screens on a device or emulator; AI suggestions and `ffmpeg` keyframe extraction against a real video; behaviour behind your actual proxy/CDN; a shop's real postbacks.
