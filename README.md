# Piitrade

A short-video feed with an in-video "visual search" feature (drag-select
a region of a paused frame to find visually similar products) and an
admin dashboard for moderating content — built as a real, containerized
full-stack app.

**Stack:** React + Vite + TypeScript + Tailwind + React Router
(frontend), Express + TypeScript + Prisma + PostgreSQL (backend),
ffmpeg (video thumbnails), JWT + bcrypt (admin auth), Docker Compose.

## Running it

```bash
docker compose up --build
```

> **Deploying the frontend to Vercel:** Vercel can host the frontend
> (it's a static Vite build), but it **cannot run the backend** — no
> persistent Postgres, no writable disk for uploaded videos, no
> `ffmpeg`/native-binary support. This repo includes a `vercel.json`
> that builds the frontend correctly, but two dashboard settings must
> be correct or Vercel will keep prepending paths itself and you'll
> see errors like `frontend/frontend/package.json`:
>
> 1. **Project Settings → General → Root Directory**: leave it blank
>    (repository root), *not* `frontend`. `vercel.json` already does
>    `npm install --prefix frontend` itself — if Root Directory is
>    also set to `frontend`, the two combine into a doubled,
>    non-existent path.
> 2. **Project Settings → Build & Development Settings**: clear any
>    custom Install/Build Command override so `vercel.json` is what
>    actually runs (a saved dashboard override takes priority over the
>    file and re-introduces the same crash).
>
Then set an environment variable **`VITE_API_BASE_URL`** to wherever
you host the backend (for example, `https://piitrade-videos.onrender.com`,
or a Railway, Fly.io, or VPS host running `docker compose`) — the frontend
uses it to reach `/api` and `/uploads` cross-origin. On that backend
host, set **`ALLOWED_ORIGIN`** to include `https://yotweek.com` (and
any staging frontend origins) so CORS allows it. Without a backend deployed somewhere, the Vercel-hosted
> frontend will load but every API call (feed, upload, admin) will
> fail — Vercel is only ever the static half of this app.
>
> The simplest correct deployment remains everything together via
> Docker Compose (below), on a VPS or any Docker-friendly host.

Then open **http://localhost:8080** for the app, or
**http://localhost:8080/admin/register** to set up the admin dashboard.

On first run, the backend automatically runs its database migrations
and — if the database is empty — seeds itself with 5 sample videos and
8 sample products, all generated locally (no external downloads, no
API keys required). This means the app has real, working data the
moment it starts.

To wipe all data and reseed from scratch:

```bash
docker compose down -v
docker compose up --build
```

To run the backend's regression test suite (see "Why a search can
return 0 results..." below for what it covers):

```bash
cd backend
npm install
npm run build
npm test
```

## Admin dashboard

Visit `/admin/register` to create the first admin account — this is
always allowed with no code, so the dashboard is usable immediately.
Every registration *after* the first one requires a setup code, set via
the `ADMIN_SETUP_CODE` environment variable in `docker-compose.yml`, so
a public deployment can't have arbitrary admin accounts created by
anyone who finds the page.

From `/admin` you can:
- **Overview** — live counts of videos, comments, products, total views/likes.
- **Videos** — edit title/description, or delete a video (removes its files from disk too).
- **Comments** — pick a video, moderate (delete) its comments.
- **Products** — add, edit, or remove entries in the visual-search catalog; adding a product computes its perceptual hash automatically.

No default admin account or password is seeded — you create your own
on first visit, which avoids shipping a hardcoded credential.

## What's actually real here

Everything in this app talks to a real database and real files on disk
— there is no mock data layer:

- **Video upload** is a real multipart upload, stored on disk
  (persisted via a Docker volume) with a row in Postgres.
- **Poster thumbnails** are extracted for real from the uploaded video
  using ffmpeg, not a placeholder image.
- **Likes / favorites / saves** are persisted per anonymous browser
  session (a UUID in `localStorage`, sent as `X-Session-Id`) — viewers
  don't need an account, but state survives reloads via Postgres.
- **Comments** are real, persisted, and moderatable from the admin dashboard.
- **Visual search** computes a genuine perceptual hash (dHash) of the
  cropped selection and ranks the product catalog by Hamming distance
  — see `backend/src/lib/phash.ts`. Verified to correctly rank
  closer-colored products higher. It is *not* a deep-learning embedding
  search — see "Known limitations" below.
- **Admin auth** is real JWT + bcrypt, not a hardcoded check.

## Relationship to yotweek.com

Piitrade Videos is the **short-video companion of the yotweek.com
classifieds marketplace** and exists to send viewers there. It never
sells anything itself: there is no cart, no checkout, no order and no
marketplace login in this app. (Earlier versions did all of that
against the marketplace's `/api/orders`; it was removed because a
classifieds site has no orders — buyers contact sellers on yotweek.com.)

What it does instead:

- **Find** (the orange button on every video) — the viewer marks what
  they see, or types a search, and the app looks up matching live
  listings on yotweek.com.
- Each result is a classifieds card (price, original price if
  reduced, location, condition, store, verified-seller badge) that
  **opens the listing at `https://yotweek.com/listings/<id>`** in a
  new tab, plus a **"See all on yotweek.com"** button
  (`/listings?q=<query>`) and the site's "meet in public, inspect
  before paying" safety line.
- The account menu links to **Browse listings**, **Sell something**
  and **Safety tips** on yotweek.com.
- Links carry `utm_source=piitrade_videos&utm_medium=video` so
  yotweek.com can attribute the visits.

`PIITRADE_SITE_URL` (backend) / `VITE_PIITRADE_SITE_URL` (frontend)
set the public website; `MARKETPLACE_API` is a different thing — the
marketplace's backend JSON API, used only to search listings.

Result cards show location, condition, store, verified badge and
original price **only if the listings API returns them** (they are
read defensively from `location`/`city`, `condition`,
`store.name`/`storeName`, `user.isVerified`/`verified`/`kycVerified`
and `originalPrice`/`compareAtPrice`); a listing without them still
renders cleanly with just its title, price and image. Only listings
that are live (`status` absent or `ACTIVE`) are shown. If the real
field names differ, adjust `toResult()` in `backend/src/lib/marketplace.ts`.

## Finding items: AI identify → marketplace lookup → listing links

**The exact `.env` values to use right now** (also in `.env.example`) —
**verified by actually fetching the live site**, not just assumed:

```
AI_SEARCH=https://apkit.allan-rye-999.workers.dev
AI_SEARCH_API_KEY=
MARKETPLACE_API=https://backend-production-a662.up.railway.app
MARKETPLACE_COUNTRY=UGANDA
```

**Important — `MARKETPLACE_API` is the backend host, not `yotweek.com`.**
An earlier version of this pointed it at `https://yotweek.com`
directly, on the assumption that `https://yotweek.com/listings?q=...`
was a JSON search endpoint. It isn't — fetching that exact URL live
returned yotweek.com's full rendered HTML browse page (nav, filters,
footer, "0 listings" as page text), not JSON, which would have made
every search fail with a JSON-parse error. Fetching yotweek.com's own
homepage showed it loads its listing images from a separate backend
host — `https://backend-production-a662.up.railway.app/api/images/...`
— confirming the real JSON API lives there, at `/api/listings`,
and `/api/listings` (matching the backend source reviewed
directly for this integration). **Railway hostnames can change on
redeploy** — if this stops working, get the current one the same way:
open yotweek.com, view an image URL, and use that host.

`AI_SEARCH_API_KEY` is left blank on purpose — the live worker doesn't
check for one today. `MARKETPLACE_COUNTRY` is optional (sent as
`&country=` on every search, confirmed as a real supported parameter
on `/api/listings`); leave it blank to search without a country filter.

Tapping **Find** on a video lets you mark the region to search
as a **rectangle, square, circle, or freeform lasso** (not just a
rectangle), then runs one of two search paths:

- **AI + marketplace pipeline** (used when both `AI_SEARCH` and
  `MARKETPLACE_API` are set — see the exact values above): the cropped
  selection is sent to `AI_SEARCH` — the real, live Piitrade
  image-identification Cloudflare Worker
  (`https://apkit.allan-rye-999.workers.dev`, Workers AI: Llama 4
  Scout) — for identification, and its `suggestedTitle` (falling back
  to `description`) is used to query the real Piitrade marketplace
  backend's search: `GET {MARKETPLACE_API}/api/listings?q=<text>&sort=relevance&limit=12&country=<country>`
  (verified directly against that route's source — `q`, `sort`,
  `limit`, and `country` are all real supported query params there).
  See `backend/src/lib/marketplace.ts` and `backend/src/lib/aiSearch.ts`
  for the exact request/response shapes, and the marketplace-specific
  behavior below. The bundled `worker/` service (see below) is only a
  local-dev stand-in with the same response shape as the real worker —
  not used by default.
- **Local phash fallback** (used otherwise, e.g. local dev with no
  `.env`): the original perceptual-hash match against the seeded
  product catalog, unchanged.

Every step of this pipeline — the AI request/response, the marketplace
query/response, timing, and result counts — is logged to the backend
console, so a search that returns nothing (or unexpected results) can
be diagnosed from the logs rather than guessed at. A search with no
matches shows a decorated empty state (icon + explanation) in the
results panel rather than a bare line of text.

### Why a search can return 0 results even when the item exists — and the fix

The marketplace's own search (`/api/listings?q=`) does a **verbatim,
case-insensitive substring match of the entire query string** against
title/description — confirmed directly against its route source
(Prisma `contains: q, mode: 'insensitive'`, not word-tokenized or
fuzzy). Our AI worker deliberately writes 5-8 word descriptions
("Vintage Wooden Dining Chair with Carved Legs"). A real listing
titled just "Wooden Dining Chair" **never contains that exact phrase**
verbatim, so it gets filtered out — even though it's the right item.

`searchProductsWithFallback` (`backend/src/lib/marketplace.ts`) exists
specifically to compensate: it retries with progressively narrower
slices of the text — prefixes, suffixes, then individual meaningful
words (stopwords excluded) — capped at 10 attempts, stopping at the
first one that returns anything. This was arrived at by testing
against a simulated version of the real backend's exact matching
behavior (see `backend/test/marketplace.test.js`): a first, simpler
version (prefixes only) still failed the "Vintage Wooden Dining
Chair..." case, because "Vintage" led every prefix candidate and the
real title had no "Vintage" in it — every candidate still contained
that leading word. Both `visualSearch.ts` (AI pipeline) and the manual
search route below use this same fallback, and the response includes
`matchedQuery` so the UI can show "Matched using the shorter term
'...'" when the fallback had to kick in.

Run `npm test` in `backend/` to run this regression suite — it uses
Node's built-in test runner (`node:test`), no new dependency, and
specifically pins down that fix (deliberately breaking the fallback
ladder makes a real test fail, not just a hypothetical).

### Manual search — type to search directly

Independent of the AI crop-to-identify flow, `GET
/api/marketplace/search?q=<text>` lets a viewer type their own words
and search the marketplace directly — useful both as an alternative
when a crop-based AI identification isn't specific enough, and as a
direct way to verify whether an item genuinely exists there. It's
exposed in the UI two ways: a search box inside the results panel
(usable at any time, before or after an AI search has run), and a
"type to search instead" link in the crop overlay that skips marking
a region entirely.

Results are shown in the same "Find on Piitrade" sheet either way — a
bottom sheet, so the paused video stays visible above it. Tapping a
result opens that listing on yotweek.com; the video resumes when the
sheet is closed.

### The `worker/` service

`worker/worker.js` is a small, separate Express service that is a
**local-dev stand-in** for the real production identification
service — it implements the same `AI_SEARCH` response envelope
(`{ success, description, suggestedTitle }`) by calling Anthropic's
API (vision) to identify the marked region, rather than the real
worker's Workers AI models. It's intentionally its own service — its
own API key, timeout profile, and scaling — not bundled into the
backend, so swapping between it and the real worker only ever means
changing where `AI_SEARCH` points (no code change). `docker-compose.yml`
runs it alongside the backend and frontend automatically for local
dev. It needs `ANTHROPIC_API_KEY` set; without it, it returns a clear
503 rather than a broken response.

### Sizing fix

The crop/selection overlay (`CropOverlay.tsx`) previously stretched
the captured video frame to fill its whole canvas regardless of the
video's aspect ratio. Since the video itself renders with
`object-contain` (letterboxed on two sides unless the aspect ratios
happen to match), a selection made near a letterbox edge could
silently map onto video pixels that didn't correspond to what was
visually selected. The overlay now computes the exact letterboxed
"contain" rect and clamps all drawing/selection to it, and caps
output crops to 1600px on the longest side so payload size stays
reasonable regardless of selection size or source video resolution.



```
backend/
  prisma/schema.prisma        # Video, Comment, UserVideoState, Product, AdminUser (MarketplaceLink is deprecated/unused)
  prisma/seed.ts              # generates real sample videos (ffmpeg) + product images (sharp)
  src/routes/videos.ts        # public: list/search/upload/like/favorite/save/comments
  src/routes/visualSearch.ts  # AI-identify + marketplace lookup, or perceptual-hash fallback
  src/routes/marketplace.ts   # manual search of yotweek.com listings (read-only)
  test/marketplace.test.js    # regression tests for the search fallback ladder (npm test)
  src/routes/profile.ts       # avatar + display name (per anonymous session)
  src/routes/auth.ts          # admin register/login/me
  src/routes/admin.ts         # admin-only: video/comment moderation, product CRUD, stats
  src/lib/phash.ts            # the dHash algorithm + Hamming distance (fallback search)
  src/lib/aiSearch.ts         # client for the AI_SEARCH identification service
  src/lib/marketplace.ts      # client for the MARKETPLACE_API listings search
  src/lib/piitrade.ts         # yotweek.com URL helpers (listing / search links)
  src/lib/videoLimits.ts      # the 30-second cap + trim-window rules (npm test)
  src/lib/thumbnail.ts        # ffmpeg poster-frame extraction
  src/lib/auth.ts             # bcrypt hashing + JWT signing/verification
  src/middleware/requireAdmin.ts
worker/
  worker.js                   # standalone service hosting the identification AI (AI_SEARCH target)
frontend/
  src/components/             # header, feed, video card, crop overlay, Find results sheet, More sheet, upload + trim editor, comments, Avatar, ProfileSettings
  src/profileStore.ts         # shared avatar/display-name state (external-store pattern)
  src/soundPreference.ts      # shared feed-wide mute/unmute state (external-store pattern)
  src/admin/                  # login, register, dashboard + tabs (stats/videos/comments/products)
  src/api.ts                  # typed fetch client (public + admin)
docker-compose.yml
```

## Profile: avatar, display name, and settings

Every viewer (anonymous, session-scoped — same `X-Session-Id` pattern
as likes/favorites) can set an avatar and a
display name via `GET/PUT /api/profile` and `POST/DELETE
/api/profile/avatar`. Both are stored in the `SessionProfile` model —
the avatar as either a local disk filename or, when `IMAGES_POINT` is
configured, a full ImageKit URL (same resolution pattern as
`Video.filename`).

**The picture appears everywhere it should**, not just on the profile
page: the frontend keeps it in one shared store
(`frontend/src/profileStore.ts`, same external-store pattern as
`soundPreference.ts`) so every consumer — the header's account button and the comment
composer — reads the same state and updates
the instant it changes anywhere. A single `<Avatar>` component
(`frontend/src/components/Avatar.tsx`) renders it consistently
(picture if set, a fallback icon otherwise) so no two spots draw it
differently.

**Settings** (account menu → Settings) is a dedicated panel
(`ProfileSettings.tsx`) covering display name, the shared sound
on/off preference (see `soundPreference.ts`), and a link out to yotweek.com — rather than settings being scattered
across the profile page's header.

## Video length: 30-second limit and trimming

Videos are limited to **30 seconds** (`MAX_VIDEO_SECONDS` in
`backend/src/lib/videoLimits.ts`, mirrored as `MAX_VIDEO_SECONDS` in
`frontend/src/config.ts`) — they are short clips showing an item or a
seller, with the listing on yotweek.com carrying the detail.

A longer video is **not simply rejected** — the upload dialog opens a
**trim editor** (`frontend/src/components/VideoTrimmer.tsx`):

- a looping preview of just the selected part, over a timeline of the
  whole video;
- drag either end to trim, or drag the middle to slide the window
  (arrow keys work on the handles; Shift = 1s steps). The window can
  never be longer than 30s or shorter than 1s;
- the chosen start/end are sent as `trimStart`/`trimEnd` and the
  **server does the cut** with ffmpeg while it normalizes the file, so
  it works for every accepted format, and timestamps restart at 0.
- Formats a browser can't decode (AVI/MKV/WMV/FLV) can't be previewed
  locally. They upload as before; if the server measures them over 30s
  it answers `VIDEO_TOO_LONG` with the real duration, and the dialog
  switches to a no-preview mode where the uploader picks the start
  time.

The limit is enforced on the server (the client check is only
convenience): the source length is read with ffprobe **before** any
transcoding, and the finished file is measured again before it is
stored. Videos uploaded before this limit existed (up to 60s) are left
as they are.

## Adding audio to a video

Once a video is chosen, the upload editor offers **Add audio** (music or
a voiceover — MP3, M4A, AAC, WAV, OGG, Opus, FLAC, up to 50 MB). The
uploader sets:

- **Original sound** and **Added audio** volumes (0–100%). Original
  sound at *Off* replaces the video's sound with the added audio.
- **Start the audio at** — which part of the track to use, when the
  track is longer than the clip.

The preview plays the added audio in step with the video (including
inside the trim editor's loop), so the mix can be heard before posting.
The browser preview is only a guide — the real mix is made on the
server (`lib/audioMix.ts`, `lib/videoTranscode.ts`) with ffmpeg:

- the audio is **cut to the clip's length** (after any trim), so a long
  track never makes a video longer than 30 seconds;
- with sound on both sides they are **mixed** at the chosen levels
  (`amix`, no automatic level halving); a silent video simply gets the
  added audio;
- a track that ends early leaves the rest of the clip quiet rather than
  shortening the video.

Formats a browser can't decode (e.g. FLAC/Opus in some browsers) can't
be previewed, but are accepted and mixed all the same.

## Layout

The header is a slim, solid bar *beside* the video, not on it: logo,
**Latest / Trending** tabs, search, upload, and one account menu
(profile, notifications, discover, settings, and shortcuts to Browse /
Sell / Safety on yotweek.com). The video stage fills the rest. Each
video shows only Like, Comment, Share, **Find**, and a **⋯** menu
(favorite, download, report), plus the creator, title and a thin
progress line. From the `sm` breakpoint up the stage is a centred,
phone-proportioned column under a full-width header.

## Video uploads: accepted formats, transcoding, and audio

Uploads accept MP4, MOV, WebM, M4V, 3GP, AVI, MKV, WMV, and FLV (both
client-side and server-side — see `middleware/upload.ts`). Every
upload is transcoded server-side to normalized H.264/AAC MP4 before
being stored (`lib/videoTranscode.ts`), which guarantees:

- The stored file plays in every browser's `<video>` tag regardless of
  the source format/codec the uploader's device produced.
- **Audio is always preserved** — the transcode never strips an
  existing audio track (`-an` is never used); if the source has none,
  the output simply has none too.
- Playback can start before the whole file downloads (`+faststart`).

Mute/unmute itself is a single shared preference across the whole
feed (`frontend/src/soundPreference.ts`), not per-video-card local
state — unmuting one video keeps the rest of the feed unmuted too,
including after a reload (persisted to `localStorage`), matching how
TikTok/Reels/Shorts behave. All videos still start muted, since every
browser requires that for autoplay.

## Optional CDN storage (ImageKit)

Videos, poster frames, and avatars can optionally be stored on
ImageKit instead of local disk — set `VIDEO_STORE` (videos/posters)
and/or `IMAGES_POINT` (avatars) to an ImageKit URL endpoint, plus
`IMAGEKIT_PUBLIC_KEY`/`IMAGEKIT_PRIVATE_KEY` (see `.env.example` for
per-store key overrides if they're different ImageKit accounts).
Either is entirely optional and independent — whichever is unset
keeps using local disk, and a configured store that fails at upload
time (network/auth/quota) falls back to local disk for that one
upload rather than failing it (see `lib/imagekit.ts`).



**Public:**

| Method | Path | Description |
|---|---|---|
| GET | `/api/videos` | List all videos (with per-session like/favorite/save state) |
| GET | `/api/videos/search?q=` | Search by title/description |
| GET | `/api/videos/:id` | Get one video, increments view count |
| POST | `/api/videos` | Upload a video (`multipart/form-data`: `video`, `title`, `description`, optional `trimStart`/`trimEnd` in seconds; optional `audio` file with `videoVolume`, `audioVolume` (0–1) and `audioStart` in seconds). Max 30s — a longer video needs a trim window or is rejected with `code: VIDEO_TOO_LONG` and its `duration` |
| POST | `/api/videos/:id/like` \| `/favorite` \| `/save` | Toggle interaction state |
| GET/POST | `/api/videos/:id/comments` | List / post comments |
| POST | `/api/visual-search` | `multipart/form-data`: `image` — AI-identify + marketplace lookup (if configured) or ranked similar products from the local catalog |
| GET | `/api/marketplace/search` | `?q=<text>` — manual, user-typed search of yotweek.com listings (same fallback ladder as visual search); returns `results[]` (each with `listingUrl`) and `browseUrl` |
| GET | `/api/profile` | This session's avatar + display name |
| PUT | `/api/profile` | `{ displayName: string \| null }` |
| POST | `/api/profile/avatar` | `multipart/form-data`: `avatar` |
| DELETE | `/api/profile/avatar` | Remove this session's avatar |
| POST | `/api/auth/register` | Create an admin account (gated by setup code after the first) |
| POST | `/api/auth/login` | Get a JWT |

**Admin (require `Authorization: Bearer <token>`):**

| Method | Path | Description |
|---|---|---|
| GET | `/api/auth/me` | Current admin |
| GET | `/api/admin/stats` | Dashboard overview counts |
| GET/PATCH/DELETE | `/api/admin/videos/:id` | Moderate videos |
| GET | `/api/admin/videos/:id/comments` | Comments for moderation |
| DELETE | `/api/admin/comments/:id` | Remove a comment |
| GET/POST/PATCH/DELETE | `/api/admin/products` | Manage the visual-search catalog |

## Known limitations (so nothing here overstates what it does)

- **Visual search accuracy is basic by design.** A perceptual hash
  compares coarse light/dark structure — good at matching color and
  rough shape, not at recognizing "this is a jacket" the way a trained
  model would. For production-grade visual search, swap
  `computeImageHash`/`hammingDistance` in `phash.ts` for embeddings from
  a vision model (e.g. CLIP) compared in a vector database — the rest
  of the pipeline stays the same.
- **Viewers have no accounts.** Only admins log in; regular interaction
  (likes, comments, uploads) is anonymous and session-scoped by design.
  Add real viewer accounts if you need to attribute uploads/comments to
  people.
- **No rate limiting or malware/content scanning** on uploads. Add
  these before accepting uploads from the public internet.
- **Single backend instance assumed.** Uploaded files live on a local
  Docker volume; scaling the backend horizontally needs shared/object
  storage (e.g. S3) instead.
- **Set `ADMIN_SETUP_CODE` to a real value** before deploying publicly.
  It's unset in the example `docker-compose.yml`; while a missing code
  is still rejected once one admin exists (so it's not wide open),
  picking a real secret is better than relying on that default.
