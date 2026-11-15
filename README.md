# Piitrade Videos

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

## Sign-in rules
* **Anyone can watch** — feeds, search, hashtags, creator pages, comments (read) and `/v/:id` share links need no account.
* **Writes need an account, enforced on the server** (`backend/src/middleware/requireAccount.ts`): like, save,
  comment, report, follow, upload, profile edits and notification read-state return `401 SIGN_IN_REQUIRED`
  for guest sessions. Both apps react to that by opening the sign-in popup.
* Sharing is open to guests (it only increments a counter).

## Known gaps
* Crop-to-search visual search, watermarked downloads and a live music preview in the upload popup exist on the
  web app only; the mobile app has typed "Find on Piitrade" search instead.
* The rest of the web app (feed, profile…) still requires login; only `/v/:id` is public.
