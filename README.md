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
cp .env.example .env        # EXPO_PUBLIC_API_BASE_URL=https://v.piitrade.com (bare origin, no /api)
npm ci
npx expo run:android        # or: npx expo run:ios  (macOS)
```

The app talks to **https://v.piitrade.com**: `/api/*` (data) and `/uploads/*` (videos, posters, avatars when R2
isn't used). That is the same backend as the website, which lives at **https://videos.piitrade.com** and also
serves `/v/<id>` share links, the legal pages and the admin area. Both hostnames must be attached to the same
Vercel project so `/api/*` and `/uploads/*` reach the backend on each. If `EXPO_PUBLIC_API_BASE_URL` is unset, still
holds the old `*.yotweek.com` address, or names the website host, the app uses `v.piitrade.com` anyway. A request
that reaches a server without this API reports it ("…v.piitrade.com has no such endpoint") instead of a bare
`HTTP 404`.

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

## Guests and the admin area
* **Watch first.** Web and app open straight on the videos. After the guest has been watching for a while a closable
  sign-in card appears (timing is set in the admin), and a write (like, comment, follow, upload) asks for an account.
* **Admin** lives at **`/const/admin`** — first-run registration, sign-in, an analytics dashboard, site & app settings
  (guest-prompt timing, announcement, maintenance, feature switches, mobile version policy) and a system page. See `docs/ADMIN.md`.

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
