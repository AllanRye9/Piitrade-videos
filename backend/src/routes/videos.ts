import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { prisma } from '../db';
import { uploadVideoWithAudio } from '../middleware/upload';
import { extractPoster, getVideoDuration, hasAudioStream } from '../lib/thumbnail';
import { transcodeToMp4, TranscodeOptions } from '../lib/videoTranscode';
import { MAX_VIDEO_SECONDS, resolveTrimWindow, withinLimit, TrimWindow } from '../lib/videoLimits';
import { MAX_AUDIO_BYTES, resolveAudioMix } from '../lib/audioMix';
import { uploadToR2 } from '../lib/r2';
import { VIDEOS_DIR, POSTERS_DIR } from '../paths';
import { HttpError } from '../lib/httpError';
import { ensureHandle, resolveAvatarUrl } from './profile';
import { uploadLimiter, writeLimiter } from '../middleware/rateLimit';
import { extractHashtags } from '../lib/hashtags';
import { requireAccount } from '../middleware/requireAccount';
import { decodeCursor, encodeCursor, olderThan } from '../lib/cursor';
import { RANK_POOL_SIZE, ViewerSignals, decodeRankCursor, encodeRankCursor, rankVideos } from '../lib/feedRank';
import { removeStoredFile } from './admin/helpers';
import { getSiteSync } from '../lib/sites';
import { fitPlanToDuration, loadProductsFor, productCreateData, resolveProductPlan, ProductPlan, PublicProduct } from '../lib/videoProducts';
import { productLinkForDisplay, siteHomeUrl } from '../lib/siteUrls';

const router = Router();

// The 60-second cap (MAX_VIDEO_SECONDS, see lib/videoLimits.ts) is
// enforced server-side in addition to the instant client-side check,
// since the client can't be trusted — never rely on it alone.

type VideoRecord = {
  id: string;
  title: string;
  description: string;
  filename: string;
  posterFilename: string | null;
  mimeType: string;
  size: number;
  duration: number | null;
  likes: number;
  views: number;
  comments: number;
  shares: number;
  createdAt: Date;
  uploaderSessionId?: string | null;
  hashtags?: string[];
  siteId?: string | null;
  productUrl?: string | null;
  productTitle?: string | null;
  /** Filled in by attachProducts() before serialising. */
  products?: Array<{ id: string; siteId: string; url: string; title: string | null; startMs: number; endMs: number | null; x: number | null; y: number | null }>;
};

type StateRecord = { videoId: string; liked: boolean; favorited: boolean; saved: boolean };

type UploaderRecord = {
  sessionId: string;
  handle: string | null;
  displayName: string | null;
  avatar: string | null;
  /** The requesting session is this uploader (so the app hides "Follow"). */
  isOwn?: boolean;
  /** The requesting session already follows this uploader. */
  isFollowing?: boolean;
};

export function getSessionId(req: Request): string {
  const id = req.header('x-session-id');
  return id && id.trim() ? id.trim() : 'anonymous';
}

// A stored filename is either a local disk filename (served from
// /uploads/...) or, when Cloudflare R2 is configured, the full public
// R2 URL returned at upload time (older rows may still hold a legacy
// ImageKit URL until `npm run storage:migrate` has been run). Both are valid values of the same
// `filename`/`posterFilename` DB columns — this just decides how to
// turn whichever one is stored into a URL the frontend can use as-is.
export function resolveAssetUrl(value: string, localDir: 'videos' | 'posters'): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `/uploads/${localDir}/${value}`;
}

export function serialize(video: VideoRecord, state?: StateRecord, uploader?: UploaderRecord | null) {
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    url: resolveAssetUrl(video.filename, 'videos'),
    poster: video.posterFilename ? resolveAssetUrl(video.posterFilename, 'posters') : null,
    duration: video.duration,
    likes: video.likes,
    views: video.views,
    comments: video.comments,
    shares: video.shares,
    hashtags: video.hashtags || [],
    createdAt: video.createdAt,
    liked: state?.liked ?? false,
    favorited: state?.favorited ?? false,
    saved: state?.saved ?? false,
    // The connected site this video promotes and, when set, the exact product
    // page on it (always on that site's domain — enforced at write time).
    site: (() => {
      const s = getSiteSync(video.siteId);
      return s ? { slug: s.slug, name: s.name, url: siteHomeUrl(s) } : null;
    })(),
    // Older app builds read this single link (the first product).
    product: video.productUrl ? { url: productLinkForDisplay(video.productUrl), title: video.productTitle || null } : null,
    // Every pinned product, in display order. `go` is the tracked link (open it
    // relative to the site root); `url` is the direct link, a fallback only.
    products: (video.products ?? []).map((p): PublicProduct => {
      const s = getSiteSync(p.siteId);
      return { id: p.id, title: p.title, url: productLinkForDisplay(p.url), site: s ? { slug: s.slug, name: s.name } : null, go: `/go/${video.id}/${p.id}`, startMs: p.startMs, endMs: p.endMs, x: p.x, y: p.y };
    }),
    // Only ever the uploader's *public* handle/displayName/avatar —
    // never uploaderSessionId itself, which stays server-side so a
    // viewer can't be tracked across videos by session id.
    uploader: uploader?.handle
      ? { handle: uploader.handle, displayName: uploader.displayName, avatar: uploader.avatar, isOwn: !!uploader.isOwn, isFollowing: !!uploader.isFollowing }
      : null,
  };
}

/** Loads the pinned products for these videos (one query) so serialize() can include them. */
export async function attachProducts(videos: VideoRecord[]): Promise<void> {
  const map = await loadProductsFor(videos.map((v) => v.id));
  for (const v of videos) v.products = map.get(v.id) ?? [];
}

/**
 * Batch-fetches public uploader info (handle/displayName/avatar) for a
 * list of videos in a single query, same N+1-avoidance rationale as
 * fetchStatesFor() below. Videos uploaded before uploaderSessionId
 * existed, or whose uploader never claimed a public handle, simply
 * have no entry in the returned map.
 */
async function fetchUploadersFor(videos: VideoRecord[], viewerSessionId?: string): Promise<Map<string, UploaderRecord>> {
  const sessionIds = [...new Set(videos.map((v) => v.uploaderSessionId).filter((id): id is string => !!id))];
  if (sessionIds.length === 0) return new Map();
  const [profiles, followRows] = await Promise.all([
    prisma.sessionProfile.findMany({ where: { sessionId: { in: sessionIds }, handle: { not: null } } }),
    viewerSessionId && viewerSessionId !== 'anonymous'
      ? prisma.follow.findMany({ where: { followerSessionId: viewerSessionId, followingSessionId: { in: sessionIds } }, select: { followingSessionId: true } })
      : Promise.resolve([] as { followingSessionId: string }[]),
  ]);
  const following = new Set<string>(followRows.map((f: { followingSessionId: string }) => f.followingSessionId));
  return new Map(
    profiles.map((p: { sessionId: string; handle: string | null; displayName: string | null; avatar: string | null }) => [
      p.sessionId,
      {
        sessionId: p.sessionId,
        handle: p.handle,
        displayName: p.displayName,
        avatar: p.avatar ? resolveAvatarUrl(p.avatar) : null,
        isOwn: !!viewerSessionId && p.sessionId === viewerSessionId,
        isFollowing: following.has(p.sessionId),
      },
    ])
  );
}

/**
 * Batch-fetches per-session interaction state for a list of videos in a
 * single query and returns a videoId -> state map. Doing this instead of
 * one findUnique() per video (as an earlier version of this route did)
 * avoids an N+1 query pattern that would otherwise issue one extra
 * round-trip to Postgres per video in the feed.
 */
async function fetchStatesFor(videoIds: string[], sessionId: string): Promise<Map<string, StateRecord>> {
  if (videoIds.length === 0) return new Map();
  const states = await prisma.userVideoState.findMany({
    where: { sessionId, videoId: { in: videoIds } },
  });
  return new Map(states.map((s: StateRecord) => [s.videoId, s]));
}

// GET /api/videos?cursor=<videoId>&limit=20
//
// Cursor-paginated: without this, every feed load fetched the entire
// table (fine at dozens of videos, a real problem at thousands).
// Cursor is a video id rather than an offset, so results stay stable
// even as new videos are uploaded between page loads.
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Collects what we know about this viewer for the "For you" ranking: what they
 * already watched, who they follow, and the creators/hashtags behind videos
 * they liked, saved or favourited. All from tables that already exist.
 */
async function loadViewerSignals(sessionId: string, snapshot: Date): Promise<ViewerSignals> {
  const signals: ViewerSignals = { viewedIds: new Set(), followingSessionIds: new Set(), tagWeights: new Map(), creatorWeights: new Map(), locationWeights: new Map(), sessionId };
  if (sessionId === 'anonymous') return signals;

  const [viewed, engaged, follows, me] = await Promise.all([
    // Only views recorded before the feed snapshot, so watching page 1 doesn't reshuffle page 2.
    prisma.userVideoState.findMany({ where: { sessionId, viewedAt: { not: null, lt: snapshot } }, select: { videoId: true } }),
    prisma.userVideoState.findMany({
      where: { sessionId, OR: [{ liked: true }, { saved: true }, { favorited: true }] },
      select: { video: { select: { hashtags: true, uploaderSessionId: true, locationId: true } } },
      take: 100,
    }),
    prisma.follow.findMany({ where: { followerSessionId: sessionId }, select: { followingSessionId: true } }),
    prisma.sessionProfile.findUnique({ where: { sessionId }, select: { locationId: true } }),
  ]);
  signals.locationId = me?.locationId ?? null;

  for (const v of viewed) signals.viewedIds.add(v.videoId);
  for (const f of follows) signals.followingSessionIds.add(f.followingSessionId);
  for (const e of engaged) {
    for (const t of e.video.hashtags) signals.tagWeights.set(t, (signals.tagWeights.get(t) ?? 0) + 1);
    if (e.video.locationId) signals.locationWeights.set(e.video.locationId, (signals.locationWeights.get(e.video.locationId) ?? 0) + 1);
    const c = e.video.uploaderSessionId;
    if (c && c !== sessionId) signals.creatorWeights.set(c, (signals.creatorWeights.get(c) ?? 0) + 1);
  }
  return signals;
}

/** Taps and sales per video over the last 90 days, for the "sells" ranking signal. Best-effort: ranking works without it. */
async function loadSellThrough(videoIds: string[]): Promise<Map<string, { clicks: number; conversions: number }>> {
  const out = new Map<string, { clicks: number; conversions: number }>();
  if (videoIds.length === 0) return out;
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  try {
    const [clicks, convs] = await Promise.all([
      prisma.click.groupBy({ by: ['videoId'], where: { videoId: { in: videoIds }, createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.conversion.groupBy({ by: ['videoId'], where: { videoId: { in: videoIds }, createdAt: { gte: since }, status: { not: 'reversed' } }, _count: { _all: true } }),
    ]);
    for (const c of clicks as Array<{ videoId: string; _count: { _all: number } }>) out.set(c.videoId, { clicks: c._count._all, conversions: 0 });
    for (const c of convs as Array<{ videoId: string; _count: { _all: number } }>) out.set(c.videoId, { clicks: out.get(c.videoId)?.clicks ?? 0, conversions: c._count._all });
  } catch (err) {
    console.error('sell-through lookup failed:', err instanceof Error ? err.message : err);
  }
  return out;
}

router.get('/', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.limit) || DEFAULT_PAGE_SIZE));
  const rawCursor = req.query.cursor;
  const rankOffset = decodeRankCursor(typeof rawCursor === 'string' ? rawCursor.split('.')[0] : rawCursor);
  const personalised = req.query.sort === 'foryou' && (rankOffset !== null || !rawCursor || decodeCursor(rawCursor) === null);

  // ── "For you": rank a bounded pool of the newest videos for this viewer, ──
  // page through it by offset, then fall back to the chronological cursor so
  // older videos remain reachable.
  if (personalised) {
    const snapshotMs = rankOffset !== null ? Number(String(rawCursor).split('.')[1]) || Date.now() : Date.now();
    const snapshot = new Date(snapshotMs);
    const offset = rankOffset ?? 0;

    const [pool, signals] = await Promise.all([
      prisma.video.findMany({ where: { createdAt: { lte: snapshot } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: RANK_POOL_SIZE }),
      loadViewerSignals(sessionId, snapshot),
    ]);
    const sell = await loadSellThrough((pool as VideoRecord[]).map((v) => v.id));
    for (const v of pool as Array<VideoRecord & { clicks?: number; conversions?: number }>) {
      const s = sell.get(v.id);
      if (s) {
        v.clicks = s.clicks;
        v.conversions = s.conversions;
      }
    }
    const ranked = rankVideos(pool as VideoRecord[], signals, snapshotMs);
    const page = ranked.slice(offset, offset + limit);
    const end = offset + limit;

    let nextCursor: string | null = null;
    if (end < ranked.length) {
      nextCursor = `${encodeRankCursor(end)}.${snapshotMs}`;
    } else if (pool.length === RANK_POOL_SIZE) {
      // Pool exhausted: continue chronologically from the oldest video in it.
      const oldest = pool[pool.length - 1];
      nextCursor = encodeCursor(oldest.createdAt, oldest.id);
    }

    const stateMap = await fetchStatesFor(page.map((v) => v.id), sessionId);
    await attachProducts(page);
    const uploaderMap = await fetchUploadersFor(page, sessionId);
    res.json({
      videos: page.map((v) => serialize(v, stateMap.get(v.id), v.uploaderSessionId ? uploaderMap.get(v.uploaderSessionId) : null)),
      nextCursor,
    });
    return;
  }

  const cursor = decodeCursor(rawCursor);
  const videos: VideoRecord[] = await prisma.video.findMany({
    where: cursor ? olderThan(cursor) : undefined,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1, // fetch one extra to know whether there's a next page
  });
  const hasMore = videos.length > limit;
  const page = hasMore ? videos.slice(0, limit) : videos;

  const stateMap = await fetchStatesFor(page.map((v) => v.id), sessionId);
  await attachProducts(page);
  const uploaderMap = await fetchUploadersFor(page, sessionId);
  res.json({
    videos: page.map((v) => serialize(v, stateMap.get(v.id), v.uploaderSessionId ? uploaderMap.get(v.uploaderSessionId) : null)),
    nextCursor: hasMore ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id) : null,
  });
});

// GET /api/videos/trending
//
// A safe ADDITION alongside the main feed rather than a replacement
// for it — the main feed's cursor pagination is proven and this
// deliberately doesn't touch it. Ranking is a classic "hot" score
// (engagement weighted, divided by a growing power of age in hours —
// the same shape Reddit/Hacker News use) computed in raw SQL, since
// Prisma's query builder has no way to ORDER BY a computed expression
// like this. No cursor: a capped top-50 list that's recomputed fresh
// on every load, not a feed you page through indefinitely.
router.get('/trending', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const ranked = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Video"
    ORDER BY (likes * 2 + comments * 3 + shares * 4 + views * 0.1)
             / POWER(EXTRACT(EPOCH FROM (now() - "createdAt")) / 3600 + 2, 1.5) DESC
    LIMIT 50
  `;
  const ids = ranked.map((r: { id: string }) => r.id);
  if (ids.length === 0) {
    res.json({ videos: [] });
    return;
  }

  const videos: VideoRecord[] = await prisma.video.findMany({ where: { id: { in: ids } } });
  const videoMap = new Map<string, VideoRecord>(videos.map((v) => [v.id, v]));
  // `IN (...)` doesn't preserve order — re-sort to match the SQL's
  // actual ranking rather than whatever order Postgres happened to
  // return rows in.
  const ordered = ids.map((id: string) => videoMap.get(id)).filter((v: VideoRecord | undefined): v is VideoRecord => !!v);

  const stateMap = await fetchStatesFor(ids, sessionId);
  await attachProducts(ordered);
  const uploaderMap = await fetchUploadersFor(ordered, sessionId);
  res.json({
    videos: ordered.map((v: VideoRecord) => serialize(v, stateMap.get(v.id), v.uploaderSessionId ? uploaderMap.get(v.uploaderSessionId) : null)),
  });
});

// GET /api/videos/search?q=
//
// Every whitespace-separated word must match somewhere on the video — its
// title, description, hashtags, uploader (handle / display name) or location —
// so "#shoes kampala" or "@rye bike" work. A leading # or @ is just stripped.
// Results are ranked by where the match was (title > hashtag > creator >
// location > description) with engagement and recency as tie-breakers.
const SEARCH_CANDIDATES = 200;
const SEARCH_MAX_TERMS = 5;

router.get('/search', async (req: Request, res: Response) => {
  const raw = String(req.query.q || '').trim().slice(0, 100);
  const sessionId = getSessionId(req);
  const terms = [...new Set(raw.split(/\s+/).map((t) => t.replace(/^[#@]+/, '').trim()).filter(Boolean))].slice(0, SEARCH_MAX_TERMS);
  if (terms.length === 0) {
    res.json({ videos: [] });
    return;
  }

  // Uploaders whose handle / display name matches any term.
  const profiles = await prisma.sessionProfile.findMany({
    where: { OR: terms.flatMap((t) => [{ handle: { contains: t, mode: 'insensitive' as const } }, { displayName: { contains: t, mode: 'insensitive' as const } }]) },
    select: { sessionId: true, handle: true, displayName: true },
    take: 200,
  });
  const creatorMatches = (term: string) =>
    profiles.filter((p: { handle: string | null; displayName: string | null }) => `${p.handle ?? ''} ${p.displayName ?? ''}`.toLowerCase().includes(term.toLowerCase())).map((p: { sessionId: string }) => p.sessionId);

  type SearchCandidate = VideoRecord & { location: { name: string; city: string } | null; hashtags: string[] };
  const candidates: SearchCandidate[] = await prisma.video.findMany({
    where: {
      AND: terms.map((t) => ({
        OR: [
          { title: { contains: t, mode: 'insensitive' as const } },
          { description: { contains: t, mode: 'insensitive' as const } },
          { hashtags: { has: t.toLowerCase() } },
          { uploaderSessionId: { in: creatorMatches(t) } },
          { location: { is: { OR: [{ name: { contains: t, mode: 'insensitive' as const } }, { city: { contains: t, mode: 'insensitive' as const } }] } } },
        ],
      })),
    },
    include: { location: { select: { name: true, city: true } } },
    orderBy: { createdAt: 'desc' },
    take: SEARCH_CANDIDATES,
  });

  const lower = terms.map((t) => t.toLowerCase());
  const now = Date.now();
  const scored = candidates.map((v: SearchCandidate) => {
    const title = v.title.toLowerCase();
    const desc = v.description.toLowerCase();
    const loc = `${v.location?.name ?? ''} ${v.location?.city ?? ''}`.toLowerCase();
    let score = 0;
    for (const t of lower) {
      if (title.includes(t)) score += 3;
      if (v.hashtags.includes(t)) score += 2.5;
      if (v.uploaderSessionId && creatorMatches(t).includes(v.uploaderSessionId)) score += 2;
      if (loc.includes(t)) score += 1.5;
      if (desc.includes(t)) score += 1;
    }
    if (lower.length > 1 && title.includes(lower.join(' '))) score += 2; // exact phrase in the title
    score += Math.log1p(v.likes * 2 + v.comments * 3 + v.shares * 4 + v.views * 0.1) * 0.2;
    score += 1 / (1 + (now - v.createdAt.getTime()) / 86_400_000 / 7); // gentle recency
    return { v, score };
  });
  scored.sort((a: { v: SearchCandidate; score: number }, b: { v: SearchCandidate; score: number }) => b.score - a.score || b.v.createdAt.getTime() - a.v.createdAt.getTime());
  const videos: VideoRecord[] = scored.slice(0, MAX_PAGE_SIZE).map((x: { v: SearchCandidate }) => x.v);

  const stateMap = await fetchStatesFor(videos.map((v) => v.id), sessionId);
  await attachProducts(videos);
  const uploaderMap = await fetchUploadersFor(videos, sessionId);
  res.json({ videos: videos.map((v) => serialize(v, stateMap.get(v.id), v.uploaderSessionId ? uploaderMap.get(v.uploaderSessionId) : null)) });
});

// GET /api/videos/hashtag/:tag?cursor=&limit=
//
// Two path segments, so this can't collide with GET /:id above despite
// both being registered as single-word-looking routes — Express only
// matches /:id against exactly one segment. Cursor-paginated the same
// way the main feed is (see GET / above).
router.get('/hashtag/:tag', async (req: Request, res: Response) => {
  const tag = req.params.tag.toLowerCase();
  const sessionId = getSessionId(req);
  const cursor = decodeCursor(req.query.cursor);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.limit) || DEFAULT_PAGE_SIZE));

  const videos: VideoRecord[] = await prisma.video.findMany({
    where: { hashtags: { has: tag }, ...(cursor ? olderThan(cursor) : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const hasMore = videos.length > limit;
  const page = hasMore ? videos.slice(0, limit) : videos;

  const stateMap = await fetchStatesFor(page.map((v) => v.id), sessionId);
  await attachProducts(page);
  const uploaderMap = await fetchUploadersFor(page, sessionId);
  res.json({
    tag,
    videos: page.map((v) => serialize(v, stateMap.get(v.id), v.uploaderSessionId ? uploaderMap.get(v.uploaderSessionId) : null)),
    nextCursor: hasMore ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id) : null,
  });
});

// GET /api/videos/hashtags/trending
//
// Postgres array columns don't have a Prisma query-builder way to
// "group by element", so this is the one place in the app using
// $queryRaw — a fixed, parameterless aggregate query with no user
// input in it, unnesting every video's hashtags array and counting
// occurrences. Capped to the 20 most-used tags.
router.get('/hashtags/trending', async (_req: Request, res: Response) => {
  const rows = await prisma.$queryRaw<{ tag: string; count: bigint }[]>`
    SELECT tag, count(*) as count
    FROM "Video", unnest(hashtags) AS tag
    GROUP BY tag
    ORDER BY count DESC, tag ASC
    LIMIT 20
  `;
  res.json({ hashtags: rows.map((r: { tag: string; count: bigint }) => ({ tag: r.tag, count: Number(r.count) })) });
});

/**
 * Counts one view per session per video. Returns true only the first time this
 * session watches this video. Atomic: the flip is a conditional UPDATE, and the
 * first-ever row is a CREATE that a concurrent request can't also win (unique
 * (sessionId, videoId)), so two simultaneous calls never double-count.
 */
async function recordView(sessionId: string, videoId: string): Promise<boolean> {
  if (sessionId === 'anonymous') return false; // no identity → can't de-duplicate, so don't count
  let first = false;
  const flipped = await prisma.userVideoState.updateMany({ where: { sessionId, videoId, viewedAt: null }, data: { viewedAt: new Date() } });
  if (flipped.count > 0) {
    first = true;
  } else {
    try {
      await prisma.userVideoState.create({ data: { sessionId, videoId, viewedAt: new Date() } });
      first = true;
    } catch (err: any) {
      if (err?.code === 'P2002') return false; // row exists and was already counted
      if (err?.code === 'P2003') throw new HttpError(404, 'Video not found'); // video doesn't exist
      throw err;
    }
  }
  if (first) await prisma.video.update({ where: { id: videoId }, data: { views: { increment: 1 } } });
  return first;
}

// POST /api/videos/:id/view — called by the app once a video has actually been
// watched for a moment. (Previously only GET /:id counted views, which the feed
// never calls, so feed views were never recorded.)
router.post('/:id/view', writeLimiter, async (req: Request, res: Response) => {
  const counted = await recordView(getSessionId(req), req.params.id);
  res.json({ counted });
});

// GET /api/videos/:id
router.get('/:id', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const video: VideoRecord | null = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new HttpError(404, 'Video not found');

  await recordView(sessionId, video.id); // once per session, not once per refresh/crawler hit
  const fresh: VideoRecord = (await prisma.video.findUnique({ where: { id: video.id } })) ?? video;
  const stateMap = await fetchStatesFor([video.id], sessionId);
  await attachProducts([fresh]);
  const uploaderMap = await fetchUploadersFor([fresh], sessionId);
  res.json({ video: serialize(fresh, stateMap.get(video.id), fresh.uploaderSessionId ? uploaderMap.get(fresh.uploaderSessionId) : null) });
});

// POST /api/videos  (multipart: video, title, description, trimStart?,
//                    trimEnd?, audio?, videoVolume?, audioVolume?, audioStart?)
//
// Videos are capped at MAX_VIDEO_SECONDS (60s). A longer source is
// rejected with code VIDEO_TOO_LONG unless the uploader supplies a
// trim window (trimStart/trimEnd, in seconds, from the editor in the
// upload dialog) that brings it to 60s or less — the cut itself is
// done here with ffmpeg while the file is being normalized, so it
// works for every accepted format, including ones a browser can't
// decode and therefore can't trim locally.
//
// The editor can also add an audio track (`audio`): it is mixed with the
// video's own sound at the volumes given (`videoVolume`/`audioVolume`,
// 0–1; original sound at 0 replaces it), starting `audioStart` seconds
// into the audio, and cut to the clip's length.
router.post('/', requireAccount, uploadLimiter, uploadVideoWithAudio, async (req: Request, res: Response) => {
  const files = (req.files || {}) as { [field: string]: Express.Multer.File[] };
  const file = files.video?.[0];
  const audioFile = files.audio?.[0];

  // Every exit path below must delete whichever temporary uploads still
  // exist — never leave an unmixed original lying in the uploads dir.
  const cleanup = () => {
    for (const f of [file, audioFile]) {
      if (f && fs.existsSync(f.path)) fs.unlinkSync(f.path);
    }
  };

  if (!file) {
    cleanup();
    throw new HttpError(400, 'No video file uploaded');
  }

  const sessionId = getSessionId(req);
  const title = String(req.body.title || 'Untitled').slice(0, 200);
  const description = String(req.body.description || '').slice(0, 1000);

  // Which connected site / product page this video promotes (optional). Checked
  // up front so a bad link is rejected before any transcoding work.
  let plan: ProductPlan | null;
  try {
    plan = await resolveProductPlan(req.body);
  } catch (err) {
    cleanup();
    throw err;
  }

  // Read the duration first, before doing any (comparatively expensive)
  // transcode/poster work — an over-length or unreadable clip is
  // rejected immediately instead of wasting an ffmpeg pass on a file
  // we're about to delete anyway. ffprobe reads this straight from the
  // container regardless of format, so this works for every format
  // middleware/upload.ts accepts, not just mp4.
  const sourceDuration = await getVideoDuration(file.path);
  if (sourceDuration === null) {
    cleanup();
    throw new HttpError(422, 'Could not read this video — please upload a valid video file');
  }

  let keep: TrimWindow;
  try {
    keep = resolveTrimWindow(sourceDuration, req.body.trimStart, req.body.trimEnd);
  } catch (err) {
    cleanup();
    throw err;
  }

  // Added audio: validate the file and the mix settings before spending
  // an ffmpeg pass on anything.
  let audio: TranscodeOptions['audio'];
  if (audioFile) {
    if (audioFile.size > MAX_AUDIO_BYTES) {
      cleanup();
      throw new HttpError(400, `The audio file is too large (max ${Math.round(MAX_AUDIO_BYTES / (1024 * 1024))}MB)`, { code: 'INVALID_AUDIO' });
    }
    const audioDuration = await getVideoDuration(audioFile.path);
    if (audioDuration === null) {
      cleanup();
      throw new HttpError(422, 'Could not read this audio file — please choose a valid audio file', { code: 'INVALID_AUDIO' });
    }
    try {
      const mix = resolveAudioMix(req.body, audioDuration);
      audio = {
        path: audioFile.path,
        startSeconds: mix.audioStart,
        audioVolume: mix.audioVolume,
        videoVolume: mix.videoVolume,
        hasSourceAudio: await hasAudioStream(file.path),
      };
    } catch (err) {
      cleanup();
      throw err;
    }
  }

  // Normalize every upload to H.264/AAC MP4, whatever format it
  // arrived in. This guarantees the stored file is playable in every
  // browser's <video> tag and that its audio track is explicitly
  // preserved (never re-encoded with -an) — see lib/videoTranscode.ts.
  const transcodedFilename = `${uuid()}.mp4`;
  const transcodedPath = path.join(VIDEOS_DIR, transcodedFilename);
  const transcodeOptions: TranscodeOptions = {};
  if (keep.trimmed || audio) {
    // With added audio the output length must always be bounded: the
    // padded audio would otherwise never end.
    transcodeOptions.startSeconds = keep.start;
    transcodeOptions.durationSeconds = keep.length;
  }
  if (audio) transcodeOptions.audio = audio;
  try {
    await transcodeToMp4(file.path, transcodedPath, transcodeOptions);
  } catch (err) {
    if (fs.existsSync(transcodedPath)) fs.unlinkSync(transcodedPath);
    console.error('Video transcode failed:', (err as Error).message);
    throw new HttpError(422, audio ? 'Could not add this audio to the video — try a different audio file' : 'Could not process this video — please upload a valid video file');
  } finally {
    // The originals (whatever format they were) are never served —
    // only the normalized transcodedPath is, from here on.
    cleanup();
  }

  // Defense in depth: measure what was actually produced rather than
  // trusting the requested window, so nothing over the cap can ever
  // be stored even if an encoder overshoots or a trim was mis-sent.
  const duration = (await getVideoDuration(transcodedPath)) ?? keep.length;
  if (!withinLimit(duration)) {
    fs.unlinkSync(transcodedPath);
    throw new HttpError(
      400,
      `Videos can be at most ${MAX_VIDEO_SECONDS} seconds (this one came out at ${Math.round(duration)}s). Trim it and try again.`,
      { code: 'VIDEO_TOO_LONG', details: { duration, maxSeconds: MAX_VIDEO_SECONDS } }
    );
  }

  let posterFilename: string | null = null;
  try {
    const posterName = `${path.parse(transcodedFilename).name}.jpg`;
    await extractPoster(transcodedPath, POSTERS_DIR, posterName);
    if (fs.existsSync(path.join(POSTERS_DIR, posterName))) {
      posterFilename = posterName;
    }
  } catch (err) {
    // Poster generation is best-effort — the video still saves without one.
    console.warn('Poster generation failed:', (err as Error).message);
  }

  // The stored/served file is now the transcoded output, not the
  // original upload — record its actual size, not file.size.
  const transcodedSize = fs.statSync(transcodedPath).size;

  // Both `filename` and `posterFilename` end up holding either a local
  // disk filename or a full public URL — see serialize()'s
  // resolveAssetUrl(), which handles either transparently. When R2 is
  // configured and the upload succeeds, the local copies are removed
  // since R2 is the source of truth; on any failure (not configured,
  // or the upload call itself fails) the local files stay in place and
  // are served locally instead, so a misconfigured or briefly-down
  // bucket never blocks a video posting.
  let finalVideoFilename: string = transcodedFilename;
  let finalPosterFilename: string | null = posterFilename;
  try {
    const uploaded = await uploadToR2({ filePath: transcodedPath }, transcodedFilename, 'videos');
    if (uploaded) {
      finalVideoFilename = uploaded.url;
      fs.unlinkSync(transcodedPath);

      if (posterFilename) {
        const posterPathOnDisk = path.join(POSTERS_DIR, posterFilename);
        const uploadedPoster = await uploadToR2({ filePath: posterPathOnDisk }, posterFilename, 'posters');
        if (uploadedPoster) {
          finalPosterFilename = uploadedPoster.url;
          fs.unlinkSync(posterPathOnDisk);
        }
      }
    }
  } catch (err) {
    // R2 is configured but the upload itself failed (network, auth,
    // quota, etc). Fall back to the local copies already on disk
    // rather than losing the upload the viewer just waited for.
    console.warn('R2 upload failed, keeping local copy:', err instanceof Error ? err.message : err);
  }

  // Real sessions ('anonymous' means no X-Session-Id header at all,
  // which shouldn't happen from the app itself) get a public handle
  // so the video they're about to post is immediately discoverable at
  // /u/:handle instead of only becoming so the next time they open
  // Settings.
  if (sessionId !== 'anonymous') {
    await ensureHandle(sessionId);
  }

  const video = await prisma.video.create({
    data: {
      title,
      description,
      filename: finalVideoFilename,
      posterFilename: finalPosterFilename,
      mimeType: 'video/mp4', // always true post-transcode, regardless of the original upload's format
      size: transcodedSize,
      duration,
      uploaderSessionId: sessionId !== 'anonymous' ? sessionId : null,
      hashtags: extractHashtags(title, description),
      ...productCreateData(plan && fitPlanToDuration(plan, duration * 1000)),
    },
  });

  await attachProducts([video]);
  const uploaderMap = await fetchUploadersFor([video], sessionId);
  res.status(201).json({ video: serialize(video, undefined, video.uploaderSessionId ? uploaderMap.get(video.uploaderSessionId) : null) });
});

/**
 * Flips one boolean flag on the (session, video) state row and reports whether
 * it actually changed. Conditional UPDATE / unique CREATE, so concurrent or
 * repeated taps can't both "win" — the earlier read-then-write version let a
 * double-tap increment `likes` twice for a single like.
 */
async function setFlag(sessionId: string, videoId: string, field: 'liked' | 'favorited' | 'saved', want: boolean): Promise<boolean> {
  const flipped = await prisma.userVideoState.updateMany({ where: { sessionId, videoId, [field]: !want }, data: { [field]: want } });
  if (flipped.count > 0) return true;
  if (!want) return false; // already false (or no row yet)
  try {
    await prisma.userVideoState.create({ data: { sessionId, videoId, [field]: true } });
    return true;
  } catch (err: any) {
    if (err?.code === 'P2002') return false; // someone else just set it
    throw err;
  }
}

function makeToggleHandler(field: 'liked' | 'favorited' | 'saved') {
  return async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    const videoId = req.params.id;
    const video = await prisma.video.findUnique({ where: { id: videoId } });
    if (!video) throw new HttpError(404, 'Video not found');

    const existing = await prisma.userVideoState.findUnique({ where: { sessionId_videoId: { sessionId, videoId } } });
    const newValue = !(existing?.[field] ?? false);
    const changed = await setFlag(sessionId, videoId, field, newValue);

    let likes = video.likes;
    if (field === 'liked') {
      // Atomic increment in the database — never `video.likes + 1` from a stale read.
      const updated = changed
        ? await prisma.video.update({ where: { id: videoId }, data: { likes: { increment: newValue ? 1 : -1 } } })
        : await prisma.video.findUnique({ where: { id: videoId } });
      likes = Math.max(0, updated?.likes ?? video.likes);
    }

    // Report the state as stored, which is what the app reconciles to.
    const stored = await prisma.userVideoState.findUnique({ where: { sessionId_videoId: { sessionId, videoId } } });
    res.json({ [field]: stored?.[field] ?? newValue, likes });
  };
}

// DELETE /api/videos/:id — a creator removes their own video (and its stored files).
// Only the uploader's session may do this; everyone else gets 403 (admins use /api/admin/videos).
router.delete('/:id', requireAccount, writeLimiter, async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new HttpError(404, 'Video not found');
  if (!video.uploaderSessionId || video.uploaderSessionId !== sessionId) {
    throw new HttpError(403, 'You can only delete your own videos');
  }
  await prisma.video.delete({ where: { id: video.id } }); // comments/likes/reports cascade
  await removeStoredFile(video.filename, VIDEOS_DIR).catch((err: unknown) => console.warn('video file cleanup failed', err));
  if (video.posterFilename) await removeStoredFile(video.posterFilename, POSTERS_DIR).catch((err: unknown) => console.warn('poster cleanup failed', err));
  res.status(204).send();
});

router.post('/:id/like', requireAccount, makeToggleHandler('liked'));
router.post('/:id/favorite', requireAccount, makeToggleHandler('favorited'));
router.post('/:id/save', requireAccount, makeToggleHandler('saved'));

// POST /api/videos/:id/share
//
// Called when the viewer actually uses the share sheet or copies the
// link (see VideoCard.tsx) — a raw activity counter, not a per-session
// toggle like like/save above: sharing the same video twice is normal,
// so there's no state to read back, just an increment. This is what
// makes "how often is this shared" visible at all — nothing tracked
// it before, because nothing in the app could be shared before (no
// per-video permalink existed until this feature added one — see
// AccountPage-style single-video route at /v/:id).
router.post('/:id/share', writeLimiter, async (req: Request, res: Response) => {
  const video = await prisma.video.update({
    where: { id: req.params.id },
    data: { shares: { increment: 1 } },
  }).catch(() => null);
  if (!video) throw new HttpError(404, 'Video not found');
  res.json({ shares: video.shares });
});

// GET /api/videos/:id/comments — top-level comments only (replies are
// fetched on demand via GET /:id/comments/:commentId/replies, the same
// "collapsed by default" behavior TikTok/Instagram use), each with a
// replyCount so the frontend knows whether to show a "View N replies"
// affordance at all.
// Batch-fetches which of `commentIds` this session has liked, in one
// query — same N+1-avoidance rationale as fetchStatesFor/fetchUploadersFor
// elsewhere in this file.
async function fetchCommentLikesFor(commentIds: string[], sessionId: string): Promise<Set<string>> {
  if (commentIds.length === 0) return new Set();
  const likes = await prisma.commentLike.findMany({ where: { commentId: { in: commentIds }, sessionId } });
  return new Set(likes.map((l: { commentId: string }) => l.commentId));
}

// GET /api/videos/:id/comments — top-level comments only (replies are
// fetched on demand via GET /:id/comments/:commentId/replies, the same
// "collapsed by default" behavior TikTok/Instagram use), each with a
// replyCount so the frontend knows whether to show a "View N replies"
// affordance at all.
router.get('/:id/comments', async (req: Request, res: Response) => {
  const videoId = req.params.id;
  const sessionId = getSessionId(req);
  const [comments, replyCounts] = await Promise.all([
    prisma.comment.findMany({ where: { videoId, parentId: null }, orderBy: { createdAt: 'desc' } }),
    prisma.comment.groupBy({ by: ['parentId'], where: { videoId, parentId: { not: null } }, _count: { _all: true } }),
  ]);
  const countByParent = new Map<string, number>(
    replyCounts.map((r: { parentId: string | null; _count: { _all: number } }) => [r.parentId as string, r._count._all])
  );
  const likedSet = await fetchCommentLikesFor(comments.map((c: { id: string }) => c.id), sessionId);
  res.json({
    comments: comments.map((c: { id: string }) => ({ ...c, replyCount: countByParent.get(c.id) || 0, liked: likedSet.has(c.id) })),
  });
});

// GET /api/videos/:id/comments/:commentId/replies — replies for one
// top-level comment. No pagination: a single comment thread realistically
// never gets large enough to need it, capped at 100 as a safety valve.
router.get('/:id/comments/:commentId/replies', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const replies = await prisma.comment.findMany({
    where: { videoId: req.params.id, parentId: req.params.commentId },
    orderBy: { createdAt: 'asc' }, // replies read naturally oldest-first, unlike top-level comments
    take: 100,
  });
  const likedSet = await fetchCommentLikesFor(replies.map((r: { id: string }) => r.id), sessionId);
  res.json({ replies: replies.map((r: { id: string }) => ({ ...r, liked: likedSet.has(r.id) })) });
});

// POST /api/videos/:id/comments/:commentId/like — toggle, same
// on-repeat-call-undoes-it shape as /videos/:id/like etc.
router.post('/:id/comments/:commentId/like', requireAccount, writeLimiter, async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const commentId = req.params.commentId;
  const key = { commentId_sessionId: { commentId, sessionId } };
  const existing = await prisma.commentLike.findUnique({ where: key });

  if (existing) {
    await prisma.$transaction([
      prisma.commentLike.delete({ where: key }),
      prisma.comment.update({ where: { id: commentId }, data: { likes: { decrement: 1 } } }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.commentLike.create({ data: { commentId, sessionId } }),
      prisma.comment.update({ where: { id: commentId }, data: { likes: { increment: 1 } } }),
    ]);
  }

  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment) throw new HttpError(404, 'Comment not found');
  res.json({ liked: !existing, likes: comment.likes });
});

// POST /api/videos/:id/comments  { text, author?, parentId? }
router.post('/:id/comments', requireAccount, writeLimiter, async (req: Request, res: Response) => {
  const text = String(req.body.text || '').trim().slice(0, 500);
  if (!text) throw new HttpError(400, 'Comment text is required');

  const videoId = req.params.id;
  const commenterSessionId = getSessionId(req);
  // The display name comes from the commenter's own profile, never from the request
  // body — otherwise anyone could post as "@someone-else" or as the app itself.
  const commenterProfile = await prisma.sessionProfile.findUnique({ where: { sessionId: commenterSessionId }, select: { displayName: true, handle: true } });
  const author = (commenterProfile?.displayName || (commenterProfile?.handle ? `@${commenterProfile.handle}` : '') || 'User').slice(0, 60);
  const requestedParentId = typeof req.body.parentId === 'string' && req.body.parentId ? req.body.parentId : null;

  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) throw new HttpError(404, 'Video not found');

  // Flatten replies-to-replies to one level: if the requested parent is
  // itself a reply, attach to ITS parent instead of nesting further —
  // matches the TikTok/Instagram convention rather than allowing
  // arbitrarily deep threads.
  let parentId: string | null = null;
  let notifyRecipientSessionId: string | null = null;
  if (requestedParentId) {
    const parent = await prisma.comment.findUnique({ where: { id: requestedParentId } });
    if (!parent || parent.videoId !== videoId) throw new HttpError(404, 'Comment not found');
    parentId = parent.parentId || parent.id;
    notifyRecipientSessionId = parent.sessionId;
  }

  const [comment] = await prisma.$transaction([
    prisma.comment.create({ data: { videoId, author, text, sessionId: commenterSessionId, parentId } }),
    prisma.video.update({ where: { id: videoId }, data: { comments: { increment: 1 } } }),
  ]);

  // Replying notifies whoever you replied to; a top-level comment
  // notifies the video's uploader instead. Either way: never notify
  // yourself, and only when the recipient is actually known (older
  // comments/videos may predate sessionId/uploaderSessionId tracking).
  const recipient = requestedParentId ? notifyRecipientSessionId : video.uploaderSessionId;
  if (recipient && recipient !== commenterSessionId) {
    await prisma.notification.create({
      data: {
        recipientSessionId: recipient,
        type: 'comment',
        actorSessionId: commenterSessionId,
        videoId,
        commentText: text.slice(0, 140),
      },
    });
  }

  res.status(201).json({ comment: { ...comment, replyCount: 0, liked: false }, comments: video.comments + 1 });
});

const REPORT_REASONS = new Set(['spam', 'inappropriate', 'copyright', 'other']);

// POST /api/videos/:id/report  { reason }
//
// No moderation UI existed anywhere before this — bad content only
// came down if an admin happened to see it. One report per (video,
// session) — see the Report model's unique constraint — so this can't
// be scripted into a fake-report pile-on by one anonymous session.
router.post('/:id/report', requireAccount, writeLimiter, async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const videoId = req.params.id;
  const reason = String(req.body?.reason || '').trim().toLowerCase();
  if (!REPORT_REASONS.has(reason)) {
    throw new HttpError(400, `reason must be one of: ${[...REPORT_REASONS].join(', ')}`);
  }

  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) throw new HttpError(404, 'Video not found');

  await prisma.report.upsert({
    where: { videoId_sessionId: { videoId, sessionId } },
    update: { reason },
    create: { videoId, sessionId, reason },
  });

  res.status(201).json({ reported: true });
});

export default router;
