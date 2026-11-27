# Piitrade Videos: Global Positioning, 3 Features

## Thesis

Piitrade Videos does not compete with TikTok on entertainment. It is the **open layer between creative video and any marketplace**. TikTok Shop is a closed, single-seller-network product. This codebase is already built around the opposite idea: any shop can be registered in **Admin → Sites**, and any video can link to products on those shops.

### What already exists (the foundation)

| Asset | Where |
|---|---|
| Multi-site registry (name, API type, link templates, country, currency) | `backend/src/lib/shops/sites.ts`, `siteUrls.ts`, Admin → Sites |
| Parallel multi-site product search, one failing site isolated | `backend/src/lib/search/marketplace.ts` (`searchSites`) |
| In-video visual search (crop → AI identify → catalog lookup) | `backend/src/routes/visualSearch.ts` |
| Product link per video, restricted to connected-site domains | `resolveVideoLink` in `lib/shops/sites.ts` |
| UTM attribution on outbound links | `UTM_SOURCE` in `siteUrls.ts` |
| Video SEO: JSON-LD, video sitemap, crawler meta injection | `backend/src/lib/seo.ts`, `routes/seo.ts` |
| Ranked "For you" feed with location boost | `backend/src/lib/feed/feedRank.ts` |

### What is missing

- A video carries **one** product link.
- Clicks and conversions are **not measured**, so no shop can prove value and no creator can be paid.
- Videos only live **inside the app and site**. There is no way for a shop to put them on its own pages.

The three features below close those gaps in this order: **#1 attribution, #2 embeds, #3 shoppable moments.**

---

## Feature 1: Attribution and creator payouts (the two-sided ledger)

**Goal:** make video-to-sale measurable, so shops can see value and creators can earn.

### Behaviour
- All outbound product links go through a redirect: `GET /go/:videoId/:productId`. It logs the click (video, creator, site, timestamp, hashed viewer/session) and 302s to the product URL with UTM params.
- Sites report sales via a conversion postback: `POST /api/attribution/conversion` (signed with a per-site secret). It carries the click token, order value, currency and an external order id (idempotent).
- Each site has a `commissionPct`, set in Admin → Sites. Each conversion creates a ledger entry owed to the video's creator.
- Shops get a dashboard (clicks, conversions, revenue, top creators and videos). Creators get an earnings view in the app and web profile.
- Conversion rate becomes a ranking signal in `feedRank.ts` (small weight, with a cold-start prior), so videos that sell surface more.

### Data model (sketch)
```
Click        id, videoId, siteId, creatorSessionId, token (unique), ipHash, createdAt
Conversion   id, clickId, siteId, externalOrderId (unique per site), amount, currency, createdAt
Payout entry id, conversionId, creatorSessionId, amount, currency, status (pending|approved|paid|reversed)
Site         + commissionPct, + postbackSecret
```

### Build notes
- Prisma migration for the tables above, plus the two Site columns. Hand-check the SQL; Prisma can't run in every environment.
- Postbacks must be HMAC-signed and idempotent. Rate-limit `/go` and de-duplicate rapid repeat clicks.
- Payouts start as a **ledger only** (status and balance). Real payment rails (e.g. mobile money, bank, PayPal) come after the ledger is proven.
- Privacy: store hashed identifiers, document retention, honour consent where required.
- Admin: new permissions `attribution.view` and `payouts.manage`, with audit-log entries on status changes.

### Mobile (Expo / React Native)
- **Outbound links:** in `mobile/src/components/VideoCard.tsx`, the Shop chip and the per-site "see all" links in `sheets/FindSheet.tsx` currently open the product URL directly with `Linking.openURL`. Change them to open `${API_BASE}/go/:videoId/:productId` so every tap is logged. Keep the direct URL as a fallback if the redirect call fails.
- **Click token:** `/go` redirects with a click token appended to the product URL; shops pass it back in the postback. No extra mobile code is needed for that.
- **Earnings screen:** add a "Earnings" row to `sheets/SettingsSheet.tsx` that opens a new `sheets/EarningsSheet.tsx` (balance, pending vs approved, last 20 entries). Add `api.getEarnings()` in `mobile/src/api.ts` and the matching types in `mobile/src/types.ts`.
- **Offline/slow network:** show the product page in the system browser (`Linking`), not a WebView, so the shop's own checkout and sign-in work normally.
- **Privacy:** send the existing session id only; add no device identifiers, and mention click tracking in the in-app privacy text.

### Done when
- A click on a video's Shop button appears in the site's dashboard, and a test postback creates a ledger entry for the right creator.
- Replaying the same postback does not double-count.

---

## Feature 2: Embeds and distribution (oEmbed player + open "connect your shop" spec)

**Goal:** be everywhere without needing the app. Every connected shop becomes a distribution channel instead of a destination you have to pull traffic to.

### Behaviour
- **Embeddable player:** `/embed/:videoId` serves a minimal player (autoplay-muted, Shop button, attribution through the Feature 1 redirect). It is allowed in iframes by an explicit CSP `frame-ancestors` policy for embed routes only.
- **oEmbed:** `/api/oembed?url=…` returns the standard rich/video response so CMSs and blogs auto-embed pasted video links.
- **Shop widget script:** one `<script>` tag a shop adds to a product page. It shows creator videos that reference that product (looked up by product URL).
- **Open listing spec:** publish the contract the `piitrade` API type already uses (`GET /api/listings?q&sort&limit&country` and the response shape) as a short spec page plus a validator. Admin → Sites "Test connection" is already most of that validator.
- **Plugins:** thin Shopify and WooCommerce plugins that expose the listing contract, so a shop can be listed without custom integration work.

### Build notes
- Reuse the permalink and SEO route machinery in `routes/seo.ts` for server-rendered embed pages.
- Per-site allow-list for embedding the player (default open for embeds, configurable).
- Embed pages must not require sign-in and must not set tracking cookies without consent.
- Docs: a `docs/` page for the spec and the embed snippet.

### Mobile (Expo / React Native)
- **Share:** the share action in `VideoCard.tsx` should share the public permalink (`${WEB_URL}/v/:id`, already served with server-rendered meta and oEmbed discovery), so links shared from the app unfurl and can be embedded anywhere. `WEB_URL` is already in `mobile/src/config.ts`.
- **Copy embed code (creators):** add a "Copy embed code" action to the creator's own-video menu, using `expo-clipboard` to copy the `<iframe>` snippet for `/embed/:id`.
- **Deep links:** configure Expo `scheme` and associated domains/Android intent filters in `app.json` for your site origin, so tapping a shared or embedded video link opens the app on that video when installed. Route it to the existing single-video view. The web fallback is the permalink page.
- **Shop connection:** the app needs nothing to connect a shop; it reads sites from `GET /api/marketplace/sites` through `state/sites.ts`, so newly registered shops appear without an app update.

### Done when
- Pasting a video URL into an oEmbed-aware editor renders the player.
- A test shop page with the widget shows the right videos and its clicks appear in Feature 1's dashboard.

---

## Feature 3: Shoppable moments (multiple products pinned to timestamps)

**Goal:** move from "a link in the caption" to tap-the-object shopping across every connected catalog.

### Behaviour
- A creator can pin several products to a video, each with a start and end time and an optional on-screen hotspot position.
- **AI-assisted tagging:** at upload, sample keyframes and run the existing visual-search pipeline (`searchSites`) on them. Suggest matches, and the creator confirms, edits or removes.
- **Viewer:** product chips appear in the time windows they were pinned to. Tapping one opens the product (through the attribution redirect). The existing in-video "Find products" crop-and-search stays as the fallback.
- Backwards compatible: the current single `productUrl` is migrated into one `VideoProduct` row covering the whole video.

### Data model (sketch)
```
VideoProduct  id, videoId, siteId, url, title, startMs, endMs, x?, y?, position, createdAt
Video         productUrl/productTitle kept for one release as a fallback, then removed
```

### Build notes
- Extend `resolveVideoLink` into a validator for an array of products (same domain restriction per site).
- Keyframe extraction runs in the existing upload pipeline. It must be bounded (cap frames per video and AI calls per upload) so cost stays predictable.
- Tagging UI on web (`UploadModal`, admin `EditVideo`) and mobile (`UploadSheet`). Playback overlay in both `VideoCard` components.
- JSON-LD in `seo.ts` can list the pinned products for richer search results.

### Mobile (Expo / React Native)
- **Types and API:** add `VideoProduct` to `mobile/src/types.ts`; `Video.products?: VideoProduct[]`. Extend `uploadVideo(..., link)` in `mobile/src/api.ts` / `state/uploads.ts` to send `products` (array) instead of one link, keeping the single-link fields working for old videos.
- **Tagging UI:** in `sheets/UploadSheet.tsx`, after the clip is chosen, add a "Products" step: list AI-suggested matches (from a new `POST /api/videos/suggest-products` on the picked clip's keyframes) with confirm/remove, plus "Add product" (site chips, URL field, label) and a start/end time slider (a simple two-handle range over the clip duration).
- **Playback overlay:** in `components/VideoCard.tsx`, subscribe to the player's position (`onPlaybackStatusUpdate`, throttled to ~4 updates/s) and show the chips whose `[startMs, endMs]` contains the current time. Tapping a chip opens its attribution redirect (see Feature 1). Keep the "Find products" crop search as the fallback.
- **Performance:** render chips from a precomputed, sorted array and compute only the active index per tick; avoid re-rendering the whole card each position update (memoise the overlay component).
- **Hotspots:** if `x/y` are set, position the chip as percentages of the video frame; otherwise stack chips at the bottom above the caption.
- **Backwards compatibility:** if `products` is empty, fall back to the legacy `product` Shop chip.

### Done when
- A creator can pin two products at different times, viewers see each chip in its window, and clicks attribute correctly to each product.
- Existing single-link videos keep working unchanged.

---

## Sequencing and rationale

| Order | Feature | Why here | Effort |
|---|---|---|---|
| 1 | Attribution and payouts | Smallest build, and the prerequisite for the business model and for measuring #2 and #3 | Medium |
| 2 | Embeds and open spec | Distribution; every embed carries attribution from #1 | Medium |
| 3 | Shoppable moments | Largest build (new table, keyframe AI, tagging UI on web and mobile) and best layered on a measured pipeline | Large |

## Mobile rollout notes

- **Shared code:** web and mobile keep separate `api.ts` / `types.ts`; update both together for every API change above.
- **Order on mobile:** attribution links and the earnings sheet first (small), then share/deep links, then the moments tagging UI and overlay.
- **Release safety:** all backend changes are additive (new tables, new endpoints, legacy single-link fields kept for a release), so older app builds keep working while new ones roll out.
- **Testing:** the overlay and keyboard/sheet behaviour need on-device testing (Android and iOS). Verify with `tsc --noEmit` in `mobile/` before every build, then an EAS preview build for device checks (see `APK-BUILD.md`).
- **Config:** `EXPO_PUBLIC_API_BASE` and `EXPO_PUBLIC_WEB_URL` must be set per environment; no domains are hardcoded.

## Why this is "hard to ignore" and "copiable"

- **Hard to ignore:** shops get measurable sales from creators, creators get paid, and viewers shop across catalogs in a tap. TikTok Shop's closed model can't offer all three at once.
- **Copiable:** the whole stack is a site registry, an open listing contract and a redirect ledger. Another operator can deploy the same code for their own region and marketplaces, which makes it a pattern rather than a single product.

## Out of scope for this document

- Payment-rail integrations and payout compliance (KYC, tax) by country.
- Multilingual captions and translation (a natural follow-up for global reach).
- Moderation tooling for brand-safety on shoppable content.
