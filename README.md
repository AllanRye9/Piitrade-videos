# Yotweek

| Folder | What it is |
| --- | --- |
| `mobile/` | **React Native (Expo) app for Android + iOS** — the consumer app |
| `backend/` | Express + Prisma API. Media now lives in **Cloudflare R2** |
| `frontend/` | Web app, kept for the admin dashboard (`/const/admin`), legal pages, `/v/:id` share links and the password-reset page |

## Mobile app

Signed-out people land straight on the feed and can watch. While they watch, a
cancellable "Sign in" card appears from time to time (`NUDGE` in
`mobile/src/config.ts`: first after 20 s of watch time, then at growing gaps, max 5
per session, auto-hides after 12 s, never covers playback). Liking, commenting,
following, saving, reporting and uploading open the same sign-in popup instead.

Upload, Profile, Settings, Comments, Notifications and Sign-in are all bottom-sheet
popups (`mobile/src/components/Sheet.tsx`): tap the backdrop, drag down, or press
Android back to dismiss.

```bash
cd mobile
cp .env.example .env        # set EXPO_PUBLIC_API_BASE_URL
npm ci
npx expo run:android        # or: npx expo run:ios  (macOS)
```

### APK in GitHub Actions
`.github/workflows/android-apk.yml` runs `expo prebuild` + `gradlew assembleRelease` and uploads
`yotweek-apk`. Set repository **variable** `API_BASE_URL` (and optionally `WEB_URL`), then run
the workflow. That APK is signed with the debug keystore — fine for sideloading/testing.
For Play Store / App Store builds use EAS (`mobile/eas.json`): `npx eas-cli build -p android|ios --profile production`.

## Admin dashboard (`/const/admin`)
Open `https://<your-site>/const/admin`. (`/admin` redirects there.)

* **First run:** click *Register* — the first account becomes the **primary admin** with full control.
  Registration then closes for good. Set `ADMIN_SETUP_CODE` on the server to require a code for that first
  registration so nobody can claim a fresh deployment before you.
* **Secondary admins:** the primary admin adds them under *Admins & roles* and ticks exactly what each may
  view / create / edit / delete (Users, Videos, Comments, Reports, Products, Locations). Permissions are
  re-checked on every request, so disabling an admin or changing permissions applies immediately.
  Only the primary admin can manage admins or read the *Activity log* (audit trail of admin actions).
* **Manage:** users (create, edit, suspend, delete), videos (search, preview, edit, delete), comments, the
  report queue, products, and locations (tag videos and users).
* Existing deployments: migration `20250114000000_admin_roles_locations` promotes the oldest existing admin to
  primary; other existing admins keep their previous access as secondary admins.

## Cloudflare R2
See `backend/.env.example`. Create a bucket, enable public access (custom domain recommended), create an
R2 API token with Object Read & Write, then set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`. Existing ImageKit files keep working until you run
`npm run storage:migrate -- --dry` and then `npm run storage:migrate` in `backend/`.

### R2 CORS (required for the web app)
The web player loads videos with `crossOrigin="anonymous"` (needed for the watermarked-download canvas), so the
bucket must send CORS headers or the browser blocks playback. Cloudflare dashboard → R2 → your bucket →
**Settings → CORS policy → Add** and paste `backend/r2-cors.json` (edit the origins to your site). The mobile app
does not need CORS. Serving the bucket from a custom domain also lets Cloudflare cache the videos.

## Sign-in rules
* **Anyone can watch** — feeds, search, hashtags, creator pages, comments (read) and `/v/:id` share links need no account.
* **Writes need an account, enforced on the server** (`backend/src/middleware/requireAccount.ts`): like, save,
  comment, report, follow, upload, profile edits and notification read-state return `401 SIGN_IN_REQUIRED`
  for guest sessions. Both apps react to that by opening the sign-in popup.
* Sharing is open to guests (it only increments a counter).

## Known gaps
* Crop-to-search visual search, watermarked downloads and a live music preview in the upload popup exist on the
  web app only; the mobile app has typed "Find products" search instead.
* The rest of the web app (feed, profile…) still requires login; only `/v/:id` is public.

## Shoppable video: attribution, embeds, product moments

Full contract for shops: [`docs/OPEN_SHOP_SPEC.md`](docs/OPEN_SHOP_SPEC.md). A WooCommerce plugin draft is in `integrations/woocommerce/`.

- **Attribution & payouts:** every Shop button opens `/go/:videoId/:productId`, which logs the tap and forwards to the shop with `?yw_click=<token>`. Shops report paid orders to `POST /api/attribution/conversion` (HMAC-signed with the site's postback secret, shown in Admin → Sites). Each sale becomes a ledger entry for the creator (`commissionPct` of the sale): pending → approved → paid, or reversed. Review them in **Admin → Earnings**. The app only records the amounts; sending money is done by the operator. Creators see their ledger in Settings → Earnings. Videos that actually sell rank a little higher in "For you".
- **Embeds:** `/embed/:id` (iframe player), `/api/oembed`, `/widget.js` (videos on a shop's product page) and `/track.js` (remembers the click on the shop). Limit framing with `EMBED_FRAME_ANCESTORS`.
- **Product moments:** a video can have up to 8 products, each optionally shown only between two times and placed on the frame. Creators edit them from a video's ⋯ menu ("Products in this video"), where AI can suggest matches from a few frames.
- **Deploy:** run `npx prisma migrate deploy` (adds `VideoProduct`, `Click`, `Conversion`, and `Site.commissionPct`/`postbackSecret`; existing single product links become one product each). nginx/Vercel route `/go`, `/embed`, `/widget.js`, `/track.js` to the backend. Grant admins `attribution.view` / `attribution.edit` as needed.

## Sites (multiple marketplaces)

Videos link to products on one or more shops. Nothing about which shops exist is hardcoded: manage them in **Admin → Sites**.

- **Fields:** name, website, optional API address, API type, country/currency, and link patterns (`{id}` / `{q}` placeholders) for product pages, search and "sell".
- **API type:** `piitrade` (the shop exposes `GET /api/listings?q&sort&limit&country`, so visual search and in-app "Find products" return live items) or `link-only` (only browse/search links are offered).
- **Test connection** in the site form checks the API before you save.
- **Uploads & admin video edit:** creators pick a site and paste a product URL; the URL must be on a connected site's domain. Deleting a site clears the product links that pointed at it.
- **Search** queries all active sites in parallel; one failing site doesn't break the others.
- **Private/internal API hosts are rejected in production** (SSRF guard). Set `ALLOW_PRIVATE_SITE_URLS=true` to override for local dev.
- **Upgrading an existing deployment:** if the Sites table is empty at boot and `PIITRADE_SITE_URL` (plus optionally `MARKETPLACE_API`, `MARKETPLACE_COUNTRY`, `MARKETPLACE_DEFAULT_CURRENCY`) is set, one site is seeded from them once. Otherwise just add sites in the admin.
- **CORS:** set `ALLOWED_ORIGIN` (comma-separated) and `SITE_URL` to your own origins; edit `backend/r2-cors.json` for R2.
- Run `npx prisma migrate deploy` to apply the `sites` migration.

## SEO & link previews

The frontend is a client-rendered SPA, so the backend (`backend/src/routes/seo.ts`) serves the crawler-facing pages and the proxy forwards exactly these paths to it (`frontend/nginx.conf`, `vercel.json`):

| Path | What it does |
| --- | --- |
| `/v/:id` | Shared-video page: the SPA shell with real `<title>`, description, canonical, Open Graph / Twitter tags and `VideoObject` JSON-LD. Reported videos are `noindex`; unknown ids return 404. |
| `/`, `/legal/*` | Same shell with absolute canonical / Open Graph URLs. |
| `/sitemap.xml` | Home, legal pages and up to 5,000 newest videos (Google video sitemap). Videos with open reports are left out. Cached 10 min. |
| `/robots.txt` | Blocks `/const/`, `/admin`, `/api/`, `/reset-password`; points at the sitemap. |

Set `SITE_URL` (e.g. `https://videos.yotweek.com`) so canonical URLs and the sitemap use your public origin; otherwise it is derived from the request host. `SPA_SHELL_URL` is where the backend fetches the built `index.html` (defaults to `http://frontend/index.html` in docker-compose). If the backend is unreachable, nginx falls back to the plain SPA.

In the app, `src/seo.ts` / `src/RouteSeo.tsx` keep the tags in sync for in-app navigation (Googlebot runs JS). Admin, password-reset and sign-in-gated screens are `noindex`; nginx also sends `X-Robots-Tag: noindex` for the admin paths.
