# Admin dashboard — `/const/admin`

The whole admin area lives under **`/const/admin`** on the website (`https://yotweek.com/const/admin`). It is not linked from
the public app, is marked `noindex`, and `/admin` simply redirects there.

## First run
Open `/const/admin`. While no admin exists the sign-in page offers **Create the primary admin** (`/const/admin/register`).
That account gets full control; registration then closes for good — further admins are created inside the dashboard.
Set `ADMIN_SETUP_CODE` on the server so nobody can claim a fresh deployment before you do.

## Roles
* **Primary admin** — everything, plus *Admins & roles*, *Activity log* and *System*.
* **Secondary admins** — only the permissions the primary ticks (users, videos, comments, reports, products, locations,
  shops, attribution, payouts, **Site & app settings**). Non-view permissions imply view.

## Dashboard
Range selector (7 / 30 / 90 days). Each KPI card shows the total, the change against the previous period of the same length
and a trend line; click one to chart it: **new users, uploads, comments, partner clicks, sales reported**.
Also: partner funnel (tags shown → saved → clicked → sold), top partners by clicks, most-watched videos, platform totals,
latest uploads and a **needs-attention** strip (open reports, partner applications waiting, maintenance on, sign-ups paused,
database down, migrations behind). Sections only appear for permissions you hold.

## Site & app settings (applies to the website AND the mobile app)
Served to both by `GET /api/config`; changes are live within ~15 s (server cache) and the apps re-read on start/foreground.

| Section | What it does |
|---|---|
| **Watch first, sign in later** | Everyone lands on the videos. After `firstAfterSeconds` of real watching a closable “Sign in” card appears, then again after `baseGapSeconds`, each gap × `backoff`, at most `maxPerSession` times; hides itself after `autoHideSeconds`. A live preview shows the resulting schedule. Defaults: 20 s, 60 s, ×1.6, 5, 12 s. |
| **Announcement banner** | One message (info / good news / warning, optional link) on web and app. Dismissible; reappears only when you change it. |
| **Maintenance mode** | Refuses every write with `503 MAINTENANCE` while watching keeps working. Admin, partner conversion postbacks and analytics events are never blocked, so you can always switch it off. |
| **Feature switches** | Sign-ups, uploads, comments, partner applications — each closes just its own route (`403` with a clear message). |
| **Mobile app versions** | `minVersion` shows a blocking *Update required* screen on older builds; `latestVersion` shows a dismissible hint; `updateUrl` is the download/store link. |

If settings can't be read the defaults apply (fail open) — a settings outage never takes the site down.

## System (primary only)
Database reachability and latency, migrations applied vs shipped (a deploy that forgot `prisma migrate deploy` shows up
here and on the dashboard), uptime, memory, and a configuration checklist (booleans only, never secret values). *Clear caches*
drops the shop-search and settings caches.

## Other pages
Users · Videos · Comments · Reports · Products · Locations · Shops · **Partner applications** (see `PARTNERS.md`) ·
Attribution · Payouts · Admins & roles · Activity log · My account.

## Video curation: delete, hide, position

On **Videos** (needs `videos.edit`; delete needs `videos.delete`):

| Action | Effect |
|---|---|
| **Hide / Unhide** | Hidden videos vanish from the feed, trending, search, hashtags, profiles, notifications, and the permalink/embed pages (404). Nothing is deleted, so it's reversible. Hiding also removes any pin. |
| **Pin to top** | Pinned videos lead the Latest feed (first page) in pin order. Max 20. Hidden videos can't be pinned. |
| **Position** | Filter **Pinned (feed order)** and use the up/down arrows to reorder. |
| **Delete** | Permanent: row, comments and stored files. Asks for confirmation. |

API: `POST /api/admin/videos/:id/hide|unhide`, `PUT /api/admin/videos/:id/pin {pinned, position?}`,
`PUT /api/admin/videos/pins/order {ids}`, `GET /api/admin/videos?status=hidden|visible|pinned`. All audited
(`video.hide`, `video.unhide`, `video.pin`, `video.unpin`, `video.reorder`, `video.delete`).
Apply migration `20250123000000_video_hide_position` (`prisma migrate deploy`).
