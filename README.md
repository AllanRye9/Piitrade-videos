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
> Then set an environment variable **`VITE_API_BASE_URL`** to wherever
> you host the backend (e.g. `https://api.yourapp.com`, from Railway,
> Render, Fly.io, or a VPS running `docker compose`) — the frontend
> uses it to reach `/api` and `/uploads` cross-origin. On that backend
> host, also set **`ALLOWED_ORIGIN`** to your Vercel URL so CORS
> allows it. Without a backend deployed somewhere, the Vercel-hosted
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

## In-video shopping: AI identify → marketplace lookup → cart → checkout

Tapping **Search** on a video now lets you mark the region to search
as a **rectangle, square, circle, or freeform lasso** (not just a
rectangle), then runs one of two search paths:

- **AI + marketplace pipeline** (used when both `AI_SEARCH` and
  `MARKETPLACE_API` are set): the cropped selection is sent to
  `AI_SEARCH` — in production this should be the real Piitrade
  image-identification Cloudflare Worker (the same one used elsewhere
  for AI-powered listing generation); the bundled `worker/` service
  (see below) is only a local-dev stand-in with the same response
  shape — for identification, and the resulting text is used to query
  the **real Piitrade marketplace's** `GET /api/listings` search. This
  is wired against that marketplace's actual API (its repo was
  reviewed directly), not an assumed contract — see
  `backend/src/lib/marketplace.ts` for the exact endpoints/fields, and
  `backend/src/lib/aiSearch.ts` for the exact `AI_SEARCH` response
  shape it expects (`{ success, description, suggestedTitle }`), and
  the marketplace-specific behavior below.
- **Local phash fallback** (used otherwise, e.g. local dev): the
  original perceptual-hash match against the seeded product catalog,
  unchanged.

Results are shown in the same results panel either way. Tapping a
result adds it to an in-video cart; once the cart has an item, a blue
**"Click to checkout"** bar appears. Checkout:

1. Checks whether this browser session already has a linked
   marketplace account (`GET /api/marketplace/account`).
2. If not, prompts login/register.
   - **Login** proceeds straight into checkout.
   - **Register does NOT** — the marketplace requires email
     verification before its `/api/auth/login` will succeed (this is
     enforced by the marketplace itself, not a choice made here), so
     registering shows a "check your email, then log in" screen
     instead of pretending checkout can continue immediately.
3. If already linked, checks out immediately.
4. On success (or on cancel at any point), the video **resumes
   watching** — it's paused only for the duration of this flow, never
   permanently.

**Same-seller order grouping.** The marketplace's `POST /api/orders`
requires every item in one order to belong to the same seller. Since
an AI-identified search can surface products from different sellers,
checkout groups cart items by `sellerId` (carried through from the
search result) and places one order per seller. If the cart has items
from 3 sellers, checkout produces up to 3 orders; if one seller's
group fails, the rest still go through and the failed items stay in
the cart rather than the whole checkout failing.

**Session tokens.** The marketplace's access token expires in ~1h;
rather than asking a returning viewer to log in again, checkout
transparently exchanges the stored refresh token for a new access
token on a 401 and retries once. Both tokens are stored server-side
only (see the `MarketplaceLink` Prisma model), keyed by the same
anonymous `X-Session-Id` used elsewhere in the app — neither is ever
sent to the browser. The refresh token itself is extracted by hand
from the marketplace's httpOnly `Set-Cookie` on login, since this is
a server-to-server call rather than a browser session.

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
  prisma/schema.prisma        # Video, Comment, UserVideoState, Product, AdminUser, MarketplaceLink
  prisma/seed.ts              # generates real sample videos (ffmpeg) + product images (sharp)
  src/routes/videos.ts        # public: list/search/upload/like/favorite/save/comments
  src/routes/visualSearch.ts  # AI-identify + marketplace lookup, or perceptual-hash fallback
  src/routes/marketplace.ts   # marketplace account link (login/register), checkout
  src/routes/auth.ts          # admin register/login/me
  src/routes/admin.ts         # admin-only: video/comment moderation, product CRUD, stats
  src/lib/phash.ts            # the dHash algorithm + Hamming distance (fallback search)
  src/lib/aiSearch.ts         # client for the AI_SEARCH identification service
  src/lib/marketplace.ts      # client for the MARKETPLACE_API service
  src/lib/thumbnail.ts        # ffmpeg poster-frame extraction
  src/lib/auth.ts             # bcrypt hashing + JWT signing/verification
  src/middleware/requireAdmin.ts
worker/
  worker.js                   # standalone service hosting the identification AI (AI_SEARCH target)
frontend/
  src/components/             # feed, video card, crop overlay, cart bar, checkout modal, upload/comment modals
  src/admin/                  # login, register, dashboard + tabs (stats/videos/comments/products)
  src/api.ts                  # typed fetch client (public + admin)
docker-compose.yml
```

## API summary

**Public:**

| Method | Path | Description |
|---|---|---|
| GET | `/api/videos` | List all videos (with per-session like/favorite/save state) |
| GET | `/api/videos/search?q=` | Search by title/description |
| GET | `/api/videos/:id` | Get one video, increments view count |
| POST | `/api/videos` | Upload a video (`multipart/form-data`: `video`, `title`, `description`) |
| POST | `/api/videos/:id/like` \| `/favorite` \| `/save` | Toggle interaction state |
| GET/POST | `/api/videos/:id/comments` | List / post comments |
| POST | `/api/visual-search` | `multipart/form-data`: `image` — AI-identify + marketplace lookup (if configured) or ranked similar products from the local catalog |
| GET | `/api/marketplace/account` | Is this session's browser linked to a marketplace account? |
| POST | `/api/marketplace/login` \| `/register` | Link this session to a marketplace account |
| DELETE | `/api/marketplace/account` | Unlink |
| POST | `/api/marketplace/checkout` | `{ items: [{ productId, quantity }] }` — requires an already-linked account |
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
