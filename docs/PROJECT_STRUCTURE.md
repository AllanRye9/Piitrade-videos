# Project structure

Top-level folders are unchanged (`frontend/`, `backend/`, `mobile/`, `worker/`, `tests/`, `docs/`, `integrations/`) —
Dockerfiles, CI and `deploy.sh` depend on them. Only the inside of `src/` was reorganised, by feature, with no change in
behaviour (every test, typecheck and build gave the same result before and after).

## backend/src
| Folder | Holds |
|---|---|
| `lib/core/` | cross-cutting helpers: `httpError`, `cors`, `cursor`, `pagination`, `money`, `email`, `auth`, `permissions`, `audit`, `settings`, `r2`, `image` |
| `lib/video/` | everything about a video file: `videoTranscode`, `videoLimits`, **`videoStandard`** (frame size/fps/bitrate rules + probing), **`videoEdit`** (edit spec + ffmpeg graph), `keyframes` (+ `grabFrameJpeg`), `thumbnail`, `audioMix` |
| `lib/feed/` | `feedRank`, `guardrail`, `hashtags` |
| `lib/search/` | `aiSearch`, `searchSites`, `marketplace`, `piitrade`, `listingSpec`, `phash`, **`frameSearch`** (screenshot interpretation loop) |
| `lib/shops/` | shop registry and attribution: `sites`, `partners`, `attribution`, `shoppable`, `videoProducts`, `embedOrigins`, `embedPages` |
| `routes/`, `routes/admin/`, `middleware/` | HTTP layer (unchanged), plus `routes/frameSearch.ts` |

## frontend/src
| Folder | Holds |
|---|---|
| `lib/` | `api`, `apiBase`, `config`, `siteConfig`, `types`, `analytics`, `soundPreference`, **`frameStandard`** |
| `features/feed/` | `VideoCard`, `VideoFeed`, `VideoMoreSheet`, `VideoPermalinkPage`, `DiscoverPage`, `HashtagPage`, `CommentModal`, `GuestNudge`, `videoWatermark`, `guestPrompt` |
| `features/upload/` | `UploadModal`, `UploadStatus`, `VideoTrimmer`, **`VideoEditor`**, **`editModel`**, `AudioPanel`, `uploadManager`, `useAudioSync` |
| `features/search/` | `SearchResultsPanel`, `CropOverlay` |
| `features/products/` | `ProductsPanel`, `ProductsEditor`, `ProductChips`, `SavedItemsPanel`, `productLogic` |
| `features/account/` | `AccountPage`, `ProfilePage`, `ProfileSettings`, `AuthGate`, `SignInDialog`, `NotificationsPanel`, `PartnersPage`, `profileStore`, `profileActivity` |
| `components/` | app chrome shared everywhere: `TopBar`, `Avatar`, `SiteBanners`, `legal/` |
| `admin/` | admin dashboard (unchanged) |

`main.tsx`, `App.tsx`, `styles/` and `test/setup.ts` stay where `index.html`/Vite expect them. Tests sit beside the code
they test (`*.test.ts[x]`), plus `frontend/test/*.test.mjs` (plain Node, importing by explicit `.ts` path).

## mobile/src
Already organised (`components/`, `sheets/`, `screens/`, `state/`, `lib/`); only additions: `lib/editModel.ts`,
`components/EditTools.tsx`.

## Things that must stay in step across folders
`tests/` fails when they drift: `mobile/src/lib/editModel.ts` ≡ `frontend/src/features/upload/editModel.ts` (byte-identical),
the frame-standard numbers (backend ↔ web), the editor limits and look presets (backend ↔ both apps), the upload limit,
and the web/mobile display-fit rule (`frameFit`).
