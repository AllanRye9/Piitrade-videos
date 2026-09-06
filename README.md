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

> **This app is not deployable on Vercel.** Vercel runs stateless
> serverless functions for a single framework — it has no persistent
> Postgres database, no writable disk for uploaded videos, and no
> `ffmpeg`/native-binary support, all of which this backend needs. If
> you previously saw an error like `npm install --prefix frontend`
> failing to find `frontend/frontend/package.json`, that was Vercel's
> "Root Directory" project setting already pointed at `frontend` while
> the install command *also* prefixed `frontend`, doubling the path —
> but even fixed, Vercel still can't run the stateful backend. Deploy
> with Docker instead (see below), on any host that can run
> `docker compose`: a local machine, a VPS (DigitalOcean, Hetzner,
> Linode…), or a platform with Docker/Compose support (Railway,
> Render, Fly.io, AWS ECS/App Runner, etc.).

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

## Project layout

```
backend/
  prisma/schema.prisma        # Video, Comment, UserVideoState, Product, AdminUser
  prisma/seed.ts              # generates real sample videos (ffmpeg) + product images (sharp)
  src/routes/videos.ts        # public: list/search/upload/like/favorite/save/comments
  src/routes/visualSearch.ts  # perceptual-hash similarity search
  src/routes/auth.ts          # admin register/login/me
  src/routes/admin.ts         # admin-only: video/comment moderation, product CRUD, stats
  src/lib/phash.ts            # the dHash algorithm + Hamming distance
  src/lib/thumbnail.ts        # ffmpeg poster-frame extraction
  src/lib/auth.ts             # bcrypt hashing + JWT signing/verification
  src/middleware/requireAdmin.ts
frontend/
  src/components/             # feed, video card, crop overlay, upload/comment modals
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
| POST | `/api/visual-search` | `multipart/form-data`: `image` — returns ranked similar products |
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
