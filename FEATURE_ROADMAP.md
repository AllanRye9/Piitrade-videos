# Piitrade Videos — Feature Roadmap

Living tracking file for this app's feature work. Update this alongside the code — when something is finished, move it from Pending to Completed; when a new gap is found, add it to Pending (with a Suggested Solution if one's known).

---

## Completed

### Foundation
- UI overhaul — brand palette, Manrope typeface
- Cloudflare Worker AI image identification (`POST /identify` → `{success, description, suggestedTitle}`)
- Marketplace search: fuzzy two-stage matcher (2-char minimum, stopword filter)
- Video upload: 9 formats supported, ffmpeg transcoding to a single delivery format
- Shared, localStorage-persisted mute/sound state (replaced per-card state)
- ImageKit CDN integration (dual env vars)
- Two production incidents diagnosed and fixed — both were undeployed Prisma migrations (`npx prisma migrate deploy` missing from the deploy step)
- Marketplace listing-image bug — a fallback image path was being resolved against the wrong backend host

### Shopping & discovery
- Long-press (3s hold) watermarked video download — client-side canvas + MediaRecorder pipeline, animated `piitrade.com` branding burned into frames; same pipeline also runs from the Download button
- Discoverable creator accounts — `Video.uploaderSessionId`, `SessionProfile.handle`/`bio`, public `/u/:handle` profile pages, `/discover` directory

### Platform hardening (Part A)
- Real accounts — email/password, session-adoption login design (login returns the canonical session id, no other route needed to change)
- Report/flag mechanism + admin moderation queue
- Cursor pagination on the main feed (was fetching the entire table)
- Rate limiting (upload, comment, report, handle-claim, auth)
- PWA shell — manifest + narrow app-shell service worker (icon is a placeholder, see Pending)
- Effortless sound — first tap/keypress anywhere unmutes, not just the speaker icon
- One-time crop-to-shop onboarding hint

### Identity & access
- Login/register as the first step to using the app (`AuthGate` + `RequireConsumerAuth`), gates every consumer route once per browser
- Forgot/reset password — hashed single-use tokens, 1hr expiry, pluggable email sender (Resend via `RESEND_API_KEY`, console-log fallback — **needs `RESEND_API_KEY` + `APP_URL` set before real users can receive reset emails**)
- Login accepts email OR handle (username)
- Settings reachable in one tap (gear icon in TopBar, was two taps deep)
- Fixed: sign-out wasn't resetting the session id (would have let a new signup silently take over the previous account's handle/videos)
- Fixed: a Videos login swapping session id was silently disconnecting an already-linked marketplace checkout account

### Feature sequence (from the 15-cluster framework doc)
1. **Share** — shareable single-video permalink pages (`/v/:id`, didn't exist before), share counter, native share sheet with clipboard fallback
2. **Follow** — follower/following counts, follow/unfollow toggle, self-follow blocked
3. **In-app notifications** — new-follower and new-comment triggers, unread badge (polled, not push/real-time), notification panel
4. **Hashtags** — parsed automatically from title/description (no new upload UI), inline tappable tags, `/tag/:tag` results page, trending-hashtags chips on Discover
5. **Threaded comment replies** — one level deep, collapsed by default, replying notifies the original commenter (not just the video's uploader)
6. **Comment likes** — same toggle-by-uniqueness pattern as Follow/Report, own `CommentLike` table rather than reusing `UserVideoState`

### Developer tooling
- CI pipeline (`.github/workflows/ci.yml`) — typecheck + build + test for both apps on every push/PR to `main`; there was no CI configuration in this repo before this
- Long-press-to-download onboarding hint — same one-time-localStorage-flag pattern as the crop-to-shop hint; this was flagged twice as the most-hidden control in the app before being fixed

### Legal
- Terms of Service, Privacy Policy, and Copyright/DMCA policy — `/legal/terms`, `/legal/privacy`, `/legal/dmca`, reachable without an account. **These are drafted content, not reviewed by a lawyer** — placeholders like `[LEGAL ENTITY NAME]`, `[CONTACT EMAIL]`, `[JURISDICTION]`, and `[DESIGNATED AGENT NAME]` need filling in, and the substance needs real legal review before this is relied on in production.

### Discovery
- Trending feed — `GET /api/videos/trending`, a capped top-50 list ranked by a recency-weighted "hot" score (engagement ÷ a growing power of age in hours, the same shape Reddit/Hacker News use), added as a second tab alongside the existing newest-first feed rather than replacing its cursor pagination

### Reports delivered
- Codebase gap analysis (Parts A–C: architecture, UX/onboarding, "video shopping culture" gaps)
- Amazon/Noon/Dubizzle third-party marketplace integration feasibility — **rejected**, will not be pursued (see Suggested Solutions below for why)
- Business viability report — market, competition, monetization, payments, go-to-market

---

## Pending

Ordered roughly by priority, not by section — items already flagged as launch-blocking are listed first regardless of category.

### Launch-blocking
- **Mobile money checkout (MTN MoMo / Airtel Money)** — nothing in the reviewed code confirms this exists; card-first checkout would lock out most of the addressable market in this app's target region
- **Creator commission / take-rate** — no monetization engine defined; this is what gives creators a financial reason to post more shoppable video

### Product/UX
- Reactions beyond like, duet/stitch
- Real branded PWA icons (currently a placeholder SVG)
- i18n (Luganda/Swahili)

### Growth
- Push/email/SMS notifications (only in-app exists today)
- Referral program, other growth/ASO tooling
- Verification badges, creator analytics dashboard

### Bigger platform pieces
- Adaptive/HLS multi-resolution video streaming
- In-app camera, filters, AR effects, editing tools
- Live streaming
- Direct messaging, communities
- Ads, brand partnerships, live gifting, affiliate marketplace
- 2FA, social login (Google/Apple/Facebook), KYC, age verification

### Infrastructure & compliance
- Automated content moderation (nudity/violence detection) — human report/flag queue exists, automated doesn't
- Microservices, CDN, database sharding, autoscaling (currently a single Railway service)
- Broader automated test coverage (CI pipeline itself now exists — see Completed — but there's still effectively one test file for it to run)

---

## Suggested solutions

Brief, not exhaustive — enough to start from, not a full design doc for each.

- **Mobile money checkout**: confirm first whether the underlying Piitrade/3R-Elite marketplace API already supports MTN MoMo/Airtel Money — if so this is a verification task, not a build. If not, it's the single highest-priority engineering item in this whole list.
- **Creator commission**: don't invent a novel model — adapt TikTok Shop's actual structure (tiered ~10–25%, trending toward a hybrid flat-fee-plus-percentage) at a smaller scale. Needs the take-rate decided first, since commission is a slice of it.
- **Push notifications**: the in-app `Notification` model already exists; adding Web Push only needs VAPID keys + a service-worker push handler, reusing the same trigger points (follow, comment) rather than building new ones.
- **Third-party marketplace integration (Amazon/Noon/Dubizzle)**: confirmed not officially possible in the "pull their catalog in" direction on any of the three — this stays rejected. The only sanctioned versions are outbound affiliate links or becoming a seller who pushes Piitrade's own catalog *out* to those platforms, which is a business-development effort, not a code change.
- **HLS streaming**: highest engineering cost on this list — needs a resolution ladder at transcode time (ffmpeg already in place, so it's an extension of the existing pipeline) plus a segment-serving/CDN layer. Worth sequencing after the launch-blocking items, not before.
- **i18n**: start with Luganda given the stated Uganda-first market; structure it as a translation-key layer now even before full translations exist, so it isn't a rewrite later.
