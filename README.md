# Piitrade Videos

## Tests

```bash
cd backend && npm test
cd ../frontend && npm test
cd ../mobile && npm test
```

| Folder | What it is |
| --- | --- |
| `mobile/` | **React Native (Expo) app for Android + iOS** — the consumer app |
| `backend/` | Express + Prisma API. Media now lives in **Cloudflare R2** |
| `frontend/` | Web app, kept for the admin dashboard, legal pages, `/v/:id` share links and the password-reset page |

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
`piitrade-videos-apk`. Set repository **variable** `API_BASE_URL` (and optionally `WEB_URL`), then run
the workflow. That APK is signed with the debug keystore — fine for sideloading/testing.
For Play Store / App Store builds use EAS (`mobile/eas.json`): `npx eas-cli build -p android|ios --profile production`.

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

## Partners (how traffic is promoted)
Piitrade Videos exists to send viewers to Piitrade **and** to the shops and apps that connect to it. A shop connects
itself: it exposes the open listing API (`docs/LISTING_SPEC.md`) and applies at **`/partners`** (or
`POST /api/partners/apply`). The server calls the applicant's API and checks it against the spec *before* queueing the
application; an admin approves it under **Admin → Partner applications**, which registers the shop; the partner then
collects its postback secret once. See `docs/PARTNERS.md`.

## Known gaps
* Crop-to-search visual search, watermarked downloads and a live music preview in the upload popup exist on the
  web app only; the mobile app has typed "Find on Piitrade" search instead.
* The web app no longer has a login wall: like the mobile app, anyone can watch, and a write (like, comment, follow, upload…) answers `401 SIGN_IN_REQUIRED`, which opens a closable sign-in dialog (`SignInDialog`).

## Testing

Each package has its own tests; the root scripts run them all (install dependencies in `backend/`, `frontend/` and `mobile/` first).

| Command (repo root) | What it runs |
|---|---|
| `npm test` | everything below, in order |
| `npm run test:root` | repo-level tests in `tests/` — **no installs needed** |
| `npm run test:backend` | backend unit and HTTP tests, including real ffmpeg transcodes |
| `npm run test:web` | web app (`frontend/`): vitest + logic tests |
| `npm run test:mobile` | mobile app (`mobile/`): vitest + logic tests |
| `npm run typecheck` | `tsc` for backend, web and mobile |
| `npm run check` | typecheck, then all tests |

`tests/` guards what no single package can see: the upload size and video-length limits agree across backend, web, mobile and nginx; every `/api` route the apps call is mounted by the backend; web and mobile show the same product tags at the same moments and place them identically; the Android SDK in `app.json`, the APK workflow and React Native agree; no merge-conflict markers; every test file is registered so it actually runs. CI runs all of this (`.github/workflows/ci.yml`).
