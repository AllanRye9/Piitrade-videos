# Piitrade

A short-video feed with an in-video "visual search" feature (drag-select
a region of a paused frame to find visually similar products) — built as
a real, containerized full-stack app.

**Stack:** React + Vite + TypeScript + Tailwind (frontend), Express +
TypeScript + Prisma + PostgreSQL (backend), ffmpeg (video thumbnails),
Docker Compose.

## Running it

```bash
docker compose up --build
```

Then open **http://localhost:8080**.

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

## What's actually real here

Everything in this app talks to a real database and real files on disk
— there is no mock data layer:

- **Video upload** is a real multipart upload (`POST /api/videos`),
  stored on disk (persisted via a Docker volume) with a row in Postgres.
- **Poster thumbnails** are extracted for real from the uploaded video
  using ffmpeg, not a placeholder image.
- **Likes / favorites / saves** are persisted per anonymous browser
  session (a UUID generated client-side and stored in `localStorage`,
  sent as `X-Session-Id`) — no login system, but state survives reloads
  and is stored server-side in Postgres.
- **Comments** are real, persisted, and paginated per video.
- **Visual search** computes a genuine [perceptual hash](https://en.wikipedia.org/wiki/Perceptual_hashing)
  (dHash) of the cropped selection and ranks the product catalog by
  Hamming distance — see `backend/src/lib/phash.ts`. This is a real,
  deterministic, offline algorithm (not a random mock), verified to
  correctly rank closer-colored products higher. It is *not* a
  deep-learning embedding search — see "Known limitations" below.

## Project layout

```
backend/
  prisma/schema.prisma       # Video, Comment, UserVideoState, Product models
  prisma/seed.ts             # generates real sample videos (ffmpeg) + product images (sharp)
  src/routes/videos.ts       # CRUD, upload, like/favorite/save, comments
  src/routes/visualSearch.ts # perceptual-hash similarity search
  src/lib/phash.ts           # the dHash algorithm + Hamming distance
  src/lib/thumbnail.ts       # ffmpeg poster-frame extraction
frontend/
  src/components/VideoCard.tsx      # player + like/comment/save/search/download actions
  src/components/CropOverlay.tsx    # drag-to-select crop tool feeding visual search
  src/components/UploadModal.tsx    # real upload with progress bar
  src/components/CommentModal.tsx
  src/api.ts                        # typed fetch client
docker-compose.yml
```

## API summary

| Method | Path | Description |
|---|---|---|
| GET | `/api/videos` | List all videos (with per-session like/favorite/save state) |
| GET | `/api/videos/search?q=` | Search by title/description |
| GET | `/api/videos/:id` | Get one video, increments view count |
| POST | `/api/videos` | Upload a video (`multipart/form-data`: `video`, `title`, `description`) |
| DELETE | `/api/videos/:id` | Delete a video and its files |
| POST | `/api/videos/:id/like` | Toggle like |
| POST | `/api/videos/:id/favorite` | Toggle favorite |
| POST | `/api/videos/:id/save` | Toggle save |
| GET/POST | `/api/videos/:id/comments` | List / post comments |
| POST | `/api/visual-search` | `multipart/form-data`: `image` — returns ranked similar products |

## Known limitations (so nothing here overstates what it does)

- **Visual search accuracy is basic by design.** A perceptual hash
  compares coarse light/dark structure — it's good at matching color
  and rough shape but won't recognize "this is a jacket" the way a
  trained model would. For production-grade visual search, swap
  `computeImageHash`/`hammingDistance` in `phash.ts` for embeddings from
  a vision model (e.g. CLIP) compared in a vector database (pgvector,
  Pinecone, etc.) — the rest of the pipeline (crop → upload → rank →
  display) stays the same.
- **No authentication.** Interaction state is scoped to an anonymous
  per-browser session id, not a real user account. Anyone can upload,
  delete, and comment on anything. Add real auth before deploying this
  publicly.
- **No rate limiting or malware/content scanning** on uploads. Add
  these before accepting uploads from the public internet.
- **Single backend instance assumed.** Uploaded files are stored on a
  local Docker volume; if you scale the backend horizontally you'll
  need shared/object storage (e.g. S3) instead.
