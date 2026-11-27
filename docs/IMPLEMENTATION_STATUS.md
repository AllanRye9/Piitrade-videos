# GLOBAL_POSITIONING.md — implementation status

**Read this first.** The positioning doc lists a "foundation that already exists" (site registry, `searchSites`, `resolveVideoLink`, `siteUrls.ts`, `seo.ts`, `feedRank.ts`, Admin → Sites, a per-video product link). **None of that was in the codebase provided**, which had one hard-wired marketplace and no product links. The minimum needed foundation was built here (below) rather than the doc's full version.

## Foundation built (not in the provided code)
| Item | Built as |
|---|---|
| Site registry + Admin → Shops | `Site` model, `lib/shops/sites.ts`, `routes/admin/sites.ts`, `ShopsPage` (name, website host, currency/country, commission %, postback secret, active, **Test connection**) |
| Domain restriction for links | `hostMatchesSite` / `validateProducts` — links must be on an active shop's host |
| UTM + click token | `withClickParams` (`utm_*` and `pv_click`) |
| Trending ranking | `lib/feed/feedRank.ts` (the codebase only had a raw-SQL trending; there is no "For you" feed or location boost) |
| Server-rendered permalink + SEO | `/v/:id` with Open Graph, Twitter player, oEmbed discovery and `VideoObject` JSON-LD (`lib/shops/embedPages.ts`) |
| Multi-site parallel search (`searchSites`) | **Built** (`backend/src/lib/search/searchSites.ts`). Typed search, visual search and AI product suggestions query every active shop that has a listing API, in parallel with a per-shop time budget; a failing shop is reported (`shops.failed`) and skipped, results are interleaved shop by shop and tagged with `shop`, and the apps name the shop on each result when more than one answered. With no shop registered it falls back to the single `MARKETPLACE_API` marketplace as before. A shop's own `url` is honoured only on its registered host. The "See all results" link still opens piitrade.com. Search endpoints are rate limited per session (30/min), the shop list is cached for 15 s (and dropped when Admin → Shops changes), and a shop's result ids are namespaced (`<shopId>:<id>`) so two shops with the same listing id can't collide. |

## Feature 1 — Attribution and payouts: done
`GET /go/:videoId/:productId?` (+ `?url=` for non-pinned links), `POST /api/attribution/click` (app), `POST /api/attribution/conversion` (HMAC-SHA256 over `timestamp.rawBody`, ±5 min, idempotent per `(site, orderId)`, 30-day window, self-referral earns nothing), ledger (`PayoutEntry`, status machine pending→approved→paid/reversed), creator earnings API, admin Attribution + Payouts pages, permissions `sites.*`, `attribution.view`, `payouts.view|manage`, audit-logged status changes, conversion-rate ranking signal. Money is stored in minor units as BIGINT.

**Deviation (security):** the app does not open `/go` in a browser. A session id is a credential and must not appear in a URL, so the app calls `POST /api/attribution/click` (session in a header) and opens the returned URL; if that call fails it falls back to `/go` (pinned products) or the direct link, as specified.

## Feature 2 — Embeds and distribution: mostly done
Done: `/embed/:id` (iframe-able via explicit CSP `frame-ancestors`, muted autoplay, product chips in their windows, no cookies), `/api/oembed`, `/embed.js` widget + `/api/embed/by-product`, open listing spec + validator (`docs/LISTING_SPEC.md`, Test connection), share = permalink, "Share embed code" for creators, deep links (`piitrade://v/<id>` and, when `EXPO_PUBLIC_WEB_URL` is https, App Links/Universal Links via `app.config.js`).

**Per-site embed allow-list (added later):** Admin → Shops → "Allowed embed sites" (migration `20250120000000_site_embed_origins`, column `Site.embedOrigins`, default empty = open). `/embed/:id` now sends a per-video `frame-ancestors`: open unless a shop the video carries has a list, in which case a site must be allowed by every restricting shop (each shop's own website and this app always allowed), plus the global `EMBED_FRAME_ANCESTORS` as an extra narrowing. Rules live in `backend/src/lib/shops/embedOrigins.ts`; see `docs/EMBEDS.md`. The migration SQL was hand-written (Prisma can't run offline here), so run `prisma migrate deploy` and a `prisma generate` on your side.

Not done / deviations:
* **Shopify and WooCommerce plugins — not built.** The listing contract they would expose is documented.
* "Copy embed code" uses the system share sheet (`Share`) rather than `expo-clipboard`, to avoid adding a native dependency that I could not install/test for SDK 58.

## Feature 3 — Shoppable moments: done for mobile + admin, partial elsewhere
Done on web, mobile and admin: `VideoProduct` (start/end, optional hotspot, ordering), validation (shop domain, times inside the clip, hotspot 0–1, ≤8 per video), creator endpoints (`GET/PUT /api/videos/:id/products`, `POST …/suggest-products`), products accepted at upload, `products` on every video payload, JSON-LD `about`, admin product editor on the video edit dialog, mobile overlay (chips by time window; memoised so position updates only re-render when the visible set changes; hotspots are placed on the actual picture rectangle, correct for letterboxed videos), mobile tagging sheet (More → "Pin products to this video").

Not done / deviations:
* AI suggestions are **after upload** (`/api/videos/:id/suggest-products`, ≤3 keyframes, ≤3 AI calls per request, heavy-upload rate limit) rather than on the picked clip before upload — the clip is not on the server yet at that point. Requires `AI_SEARCH` and `MARKETPLACE_API`; otherwise it answers 503 and the sheet says so.
* The mobile tagging sheet uses −/+ steppers for the time window (no slider dependency) and does not place hotspots; hotspots are supported by the API and the overlay but there is no UI to position them yet.
* **Web consumer app (added later):** playback tags in `VideoCard` (`ProductChips`, time windows, hotspots placed on the real picture rectangle, memoised on the visible set), tap-to-save with a `SavedItemsPanel` (Open goes through the attribution click log), a "Shop products" section in the upload dialog (link, label, time window; sent with the upload), and More → "Pin products to this video" (`ProductsPanel`, with AI suggestions) for your own videos. Viewing analytics (`analytics.ts`: watch time and tag impressions) now also come from the web, so the guardrail and the funnel cover web viewers too. Hotspots still have no placement UI on any client.
* Web upload pins are timed against the clip **as posted** (the server now checks them against the trimmed length, not the source length).
* **Fixed:** saving pins from the app (and now the web) used to erase hotspots set elsewhere, because the creator's product list omitted `x`/`y` and saving replaces the whole list. The list now returns them and both clients send them back unchanged.
* "Migrate the legacy single `productUrl`" — there was none in this codebase.

## Saved items (added after the original three features)
Why: the goal is to sell partners' visibility without interrupting viewing. Tapping a product tag used to open a browser (leaving the video); it now **saves the item and the video keeps playing**. The tag turns into "✓ Saved · View list"; tapping it again opens the Saved items list inside the app. From the list the viewer opens the product later through the attribution redirect, so the creator is still credited for the sale.

* Backend: `SavedItem` (snapshot of url/title, unique per viewer+product, survives the creator re-pinning, kept if the video is deleted, removed with its shop), `GET/POST/DELETE /api/saved-items`, cap of 200 per viewer, `saved` flag on feed products, rate-limited. Works for guests (no sign-in prompt — an auth prompt is the interruption this avoids). Items saved as a guest stay with that guest session; signing in to an *existing* account switches session, so those guest items don't follow.
* Partners see **Saves** next to clicks and sales in Admin → Attribution.
* Mobile: tag-tap saves (optimistic, with offline/error messages), `SavedItemsSheet`, entry under Settings → Shopping.
* **Viewing guardrail + partner funnel** (done after Saved items): `docs/GUARDRAIL.md`. Randomized hold-out, aggregated watch-time stats, a verdict with a confidence range and a minimum-data rule, and the tags-shown → saved → opened → sold funnel per shop (Admin → Attribution).
* Not covered: the web embed/widget chips still link out through `/go` (they don't save); there is no saved-items badge or reminder notification yet. Saved items on the web follow the browser's session the same way they do for guests in the app.

## Verification
Backend: `tsc` clean; 137 tests, including an HTTP-level flow (click → redirect → signed postback → replay → tamper → expiry → self-referral) against an in-memory database. Schema validated with Prisma's own parser; **all migrations applied on a real PostgreSQL engine (PGlite)** and the new constraints exercised (idempotent order id, restricted shop delete, click survives video delete, product cascade, single primary admin). Mobile: `tsc` clean; pure product logic tested under Node. Admin UI: built and screenshotted.

Web: `tsc -b` clean, production build succeeds, pure logic (`npm run test:logic` in `frontend/`) tested under Node. **Not verified:** the new web screens in a browser (chips, saving, panels, upload section); the mobile screens on a device or emulator; AI suggestions and `ffmpeg` keyframe extraction against a real video; behaviour behind your actual proxy/CDN; a shop's real postbacks.

## Deployment (Railway, api.yotweek.com)
* The API is `https://api.yotweek.com` (Railway). No Render URL remains in the code, docs or build output.
* Web: `src/config.ts` uses `https://api.yotweek.com` whenever the page is served from `yotweek.com` or `www.yotweek.com`, ignoring any older `VITE_API_BASE_URL` baked into the build; other hosts (the Android app, previews) use `VITE_API_BASE_URL`, which `frontend/.env.production` sets. Mobile: `EXPO_PUBLIC_API_BASE_URL`, defaulting to the same API.
* CORS (`backend/src/lib/core/cors.ts`): with `ALLOWED_ORIGIN` unset every origin may call (as before). When set, those origins plus `yotweek.com`, `www.yotweek.com`, `piitrade.com`, `www.piitrade.com`, the Android/iOS WebView origins and local development ports are allowed. Preflights are cached for a day.

## Fix: yotweek.com web app + partner onboarding
* **Migration drift fixed.** `Site.embedOrigins` was in `schema.prisma` (and read by `/v/:id`, `/embed/:id`, the click redirect and saved items) but no migration created the column, so on a migrated database those routes failed — i.e. every tap from a video to a partner. Added `20250120000000_site_embed_origins`. Run `npx prisma migrate deploy` (the Docker entrypoint already does).
* **Web login wall removed.** The web app forced sign-in before showing anything, contradicting the README and the server rule (read is open, writes need an account) and the point of the product (sending viewers to Piitrade and partners). Guests now land on the feed; a write answers `401 SIGN_IN_REQUIRED`, which opens `SignInDialog` (closable). `RequireConsumerAuth` is deleted. Upload as a guest asks for sign-in instead of opening a dialog that can only fail.
* **Partners apply themselves.** `PartnerApplication` (migration `20250121000000_partner_applications`), public `/partners` page and `POST /api/partners/apply`, status endpoint with a one-time token, Admin → Partner applications. The applicant's listing API is checked against the spec at submission; approval creates the `Site`. See `PARTNERS.md`.
* Search sheet copy now says "Find on Piitrade & partner shops" (results already came from every active shop).
* Tests: +11 backend (partner flow incl. SSRF/duplicate/one-time-credential/double-approval cases) → 154 pass; +4 frontend → 13 pass. Browser-checked with a stub API: guest sees the feed, like opens the dialog, Esc closes it, a failing partner API shows its issues, approval shows the secret once.

## Watch-first + admin dashboard
* **Watch first, prompt later — web and app.** Nobody sees a login before the videos. A closable "Enjoying the videos? Sign in" card appears after real watch time (web: `GuestNudge`, mobile: `AppContext` + `GuestNudge`; same rule in `frontend/src/features/feed/guestPrompt.ts` / `mobile/src/lib/guestPrompt.ts`, same numbers). Timing is admin-managed.
* **Admin settings store.** `AppSetting` (migration `20250122000000_app_settings`), `lib/core/settings.ts` (validation, defaults, cache, fail-open), public `GET /api/config`, `middleware/siteSettings.ts` (maintenance + feature switches on the public API). Announcement `version` is preserved across loads so a dismissed banner stays dismissed.
* **Admin `/const/admin`**: advanced dashboard (`/api/admin/analytics`: daily series + previous-period deltas, funnel, top partners/videos, attention strip, health), **Site & app settings** page (new `settings.view/edit` permission), **System** page (`/api/admin/system`, primary only), `noindex`. See `ADMIN.md`.
* Mobile: `SiteNotice` (maintenance strip, announcement, update-available hint, blocking update-required screen), config cached in AsyncStorage.
* Tests: backend 162 pass (+8 settings/enforcement), frontend 16 pass, mobile 19 + 4 pass; typecheck clean for all three. Browser-checked: guest sees feed, prompt after ~4 s with a 3 s setting, "Maybe later" closes it, dismissed banner stays dismissed after reload; admin sign-in → dashboard → settings save → system page.
