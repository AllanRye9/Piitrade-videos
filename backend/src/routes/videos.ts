import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { prisma } from '../db';
import { uploadVideoWithAudio } from '../middleware/upload';
import { extractPoster, getVideoDuration, hasAudioStream } from '../lib/thumbnail';
import { transcodeToMp4, TranscodeOptions } from '../lib/videoTranscode';
import { describeTranscodeFailure, referenceId } from '../lib/mediaErrors';
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
import { removeStoredFile } from './admin/helpers';
import { attachProducts, loadActiveSites, replaceVideoProducts } from '../lib/videoProducts';
import { CleanProduct, validateProducts } from '../lib/shoppable';
import { extractKeyframes } from '../lib/keyframes';
import { identifyImage } from '../lib/aiSearch';
import { searchSites, searchConfigured } from '../lib/searchSites';
import { scoreVideo } from '../lib/feedRank';

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
    // Only ever the uploader's *public* handle/displayName/avatar —
    // never uploaderSessionId itself, which stays server-side so a
    // viewer can't be tracked across videos by session id.
    uploader: uploader?.handle
      ? { handle: uploader.handle, displayName: uploader.displayName, avatar: uploader.avatar, isOwn: !!uploader.isOwn, isFollowing: !!uploader.isFollowing }
      : null,
  };
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

router.get('/', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const cursor = decodeCursor(req.query.cursor);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.limit) || DEFAULT_PAGE_SIZE));

  const videos: VideoRecord[] = await prisma.video.findMany({
    where: cursor ? olderThan(cursor) : undefined,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1, // fetch one extra to know whether there's a next page
  });
  const hasMore = videos.length > limit;
  const page = hasMore ? videos.slice(0, limit) : videos;

  const stateMap = await fetchStatesFor(page.map((v) => v.id), sessionId);
  const uploaderMap = await fetchUploadersFor(page, sessionId);
  res.json({
    videos: await attachProducts(page.map((v) => serialize(v, stateMap.get(v.id), v.uploaderSessionId ? uploaderMap.get(v.uploaderSessionId) : null)), sessionId),
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
// The ranking is a full-table scan, and every viewer opening the Trending tab ran
// it. The ordering barely changes in 30s, so share one result between requests
// (per-viewer state like "liked" is still fetched fresh below).
let trendingCache: { at: number; ids: string[] } | null = null;
const TRENDING_TTL_MS = 30_000;

router.get('/trending', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  let ids: string[];
  if (trendingCache && Date.now() - trendingCache.at < TRENDING_TTL_MS) {
    ids = trendingCache.ids;
  } else {
    // Rank the newest 500 in JS so the score can include each video's click→sale record
    // (lib/feedRank.ts). Older videos decay out of contention anyway.
    const candidates = await prisma.video.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 500,
      select: { id: true, likes: true, comments: true, shares: true, views: true, createdAt: true },
    });
    const candidateIds = candidates.map((c: { id: string }) => c.id);
    const [clickRows, convRows] = candidateIds.length
      ? await Promise.all([
          prisma.click.groupBy({ by: ['videoId'], where: { videoId: { in: candidateIds } }, _count: { _all: true } }),
          prisma.conversion.findMany({ where: { click: { videoId: { in: candidateIds } } }, select: { click: { select: { videoId: true } } } }),
        ])
      : [[], []];
    const clicksBy = new Map<string, number>((clickRows as any[]).map((r) => [r.videoId as string, r._count._all as number]));
    const convsBy = new Map<string, number>();
    for (const r of convRows as any[]) {
      const vid = r.click?.videoId as string | undefined;
      if (vid) convsBy.set(vid, (convsBy.get(vid) || 0) + 1);
    }
    const now = Date.now();
    ids = candidates
      .map((c: any) => ({ id: c.id as string, score: scoreVideo({ ...c, clicks: clicksBy.get(c.id) || 0, conversions: convsBy.get(c.id) || 0 }, now) }))
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .slice(0, 50)
      .map((r: { id: string }) => r.id);
    trendingCache = { at: Date.now(), ids };
  }
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
  const uploaderMap = await fetchUploadersFor(ordered, sessionId);
  res.json({
    videos: await attachProducts(ordered.map((v: VideoRecord) => serialize(v, stateMap.get(v.id), v.uploaderSessionId ? uploaderMap.get(v.uploaderSessionId) : null)), sessionId),
  });
});

// GET /api/videos/search?q=
router.get('/search', async (req: Request, res: Response) => {
  const raw = String(req.query.q || '').trim().slice(0, 100);
  const q = raw.replace(/^#+/, '').trim(); // "#sneakers" and "sneakers" are the same search
  const sessionId = getSessionId(req);
  if (!q) {
    res.json({ videos: [] });
    return;
  }
  // Also match hashtags exactly and creators by handle/name (the old search only looked at title/description).
  const creators = await prisma.sessionProfile.findMany({
    where: { OR: [{ handle: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }], handle: { not: null } },
    select: { sessionId: true },
    take: 20,
  });
  const videos: VideoRecord[] = await prisma.video.findMany({
    where: {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { hashtags: { has: q.toLowerCase() } },
        ...(creators.length ? [{ uploaderSessionId: { in: creators.map((c: { sessionId: string }) => c.sessionId) } }] : []),
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_PAGE_SIZE, // safety cap — search has no pagination UI, just bounded results
  });
  const stateMap = await fetchStatesFor(videos.map((v) => v.id), sessionId);
  const uploaderMap = await fetchUploadersFor(videos, sessionId);
  res.json({ videos: await attachProducts(videos.map((v) => serialize(v, stateMap.get(v.id), v.uploaderSessionId ? uploaderMap.get(v.uploaderSessionId) : null)), sessionId) });
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
  const uploaderMap = await fetchUploadersFor(page, sessionId);
  res.json({
    tag,
    videos: await attachProducts(page.map((v) => serialize(v, stateMap.get(v.id), v.uploaderSessionId ? uploaderMap.get(v.uploaderSessionId) : null)), sessionId),
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
  const uploaderMap = await fetchUploadersFor([fresh], sessionId);
  res.json({ video: (await attachProducts([serialize(fresh, stateMap.get(video.id), fresh.uploaderSessionId ? uploaderMap.get(fresh.uploaderSessionId) : null)], sessionId))[0] });
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
const createVideo = async (req: Request, res: Response) => {
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

  // Read the duration first, before doing any (comparatively expensive)
  // transcode/poster work — an over-length or unreadable clip is
  // rejected immediately instead of wasting an ffmpeg pass on a file
  // we're about to delete anyway. ffprobe reads this straight from the
  // container regardless of format, so this works for every format
  // middleware/upload.ts accepts, not just mp4.
  const sourceDuration = await getVideoDuration(file.path);
  if (sourceDuration === null) {
    cleanup();
    throw new HttpError(422, 'Could not read this video — the file may be damaged, incomplete, or in an unsupported format. Re-export it as MP4 and try again.', { code: 'VIDEO_UNREADABLE' });
  }

  let keep: TrimWindow;
  try {
    keep = resolveTrimWindow(sourceDuration, req.body.trimStart, req.body.trimEnd);
  } catch (err) {
    cleanup();
    throw err;
  }

  // Pinned products (optional JSON array): validated now, before any transcoding, so a bad
  // link costs nothing. Saved below once the video row exists.
  let cleanProducts: CleanProduct[] = [];
  if (req.body.products) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(req.body.products));
    } catch {
      cleanup();
      throw new HttpError(400, 'products must be valid JSON', { code: 'INVALID_PRODUCTS' });
    }
    // Pin times are relative to the video as posted, so they're checked against the kept section, not the source.
    const checked = validateProducts(parsed, await loadActiveSites(), keep.length);
    if ('error' in checked) {
      cleanup();
      throw new HttpError(400, checked.error, { code: 'INVALID_PRODUCTS' });
    }
    cleanProducts = checked.products;
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
    // Say what actually went wrong (damaged file, unsupported codec, server out of space/memory, timeout…)
    // instead of one generic message; the reference id ties the uploader's report to the full ffmpeg log.
    const failure = describeTranscodeFailure(err, { withAudio: !!audio });
    const ref = referenceId();
    console.error(`Video transcode failed [${ref}] (${failure.code}, ${file.size} bytes, ${file.originalname}):`, (err as Error).message, (err as { stderr?: string }).stderr || '');
    throw new HttpError(failure.status, `${failure.message} (ref ${ref})`, { code: failure.code, details: { reference: ref, serverSide: failure.serverSide, ...(failure.reason ? { reason: failure.reason } : {}) } });
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
      uploadKey: ((req as any).uploadKey as string | null) ?? null,
      hashtags: extractHashtags(title, description),
    },
  });

  if (cleanProducts.length) await replaceVideoProducts(video.id, cleanProducts);

  const uploaderMap = await fetchUploadersFor([video], sessionId);
  res.status(201).json({ video: (await attachProducts([serialize(video, undefined, video.uploaderSessionId ? uploaderMap.get(video.uploaderSessionId) : null)]))[0] });
};

// Uploads transcode inside the request, so a slow proxy can cut the connection after the
// video was in fact saved — and the app's "Retry" then posted it a second time. The app sends
// a per-attempt X-Idempotency-Key: a repeat returns the video already created (200), and a
// repeat while the first is still processing gets 409 instead of starting a second transcode.
const uploadsInFlight = new Set<string>();

router.post('/', requireAccount, uploadLimiter, uploadVideoWithAudio, async (req: Request, res: Response) => {
  const key = String(req.header('x-idempotency-key') || '').trim().slice(0, 64);
  if (!key) {
    await createVideo(req, res);
    return;
  }
  const sessionId = getSessionId(req);
  const dropTemp = () => {
    const files = (req.files || {}) as { [field: string]: Express.Multer.File[] };
    for (const f of Object.values(files).flat()) if (f && fs.existsSync(f.path)) fs.unlinkSync(f.path);
  };

  const existing: VideoRecord | null = await prisma.video.findUnique({ where: { uploadKey: key } });
  if (existing && existing.uploaderSessionId === sessionId) {
    dropTemp();
    const uploaderMap = await fetchUploadersFor([existing], sessionId);
    res.status(200).json({ video: (await attachProducts([serialize(existing, undefined, existing.uploaderSessionId ? uploaderMap.get(existing.uploaderSessionId) : null)]))[0] });
    return;
  }
  const flightKey = `${sessionId}:${key}`;
  if (uploadsInFlight.has(flightKey)) {
    dropTemp();
    throw new HttpError(409, 'This video is still being processed — check your profile in a moment.', { code: 'UPLOAD_IN_PROGRESS' });
  }
  uploadsInFlight.add(flightKey);
  (req as any).uploadKey = key;
  try {
    await createVideo(req, res);
  } finally {
    uploadsInFlight.delete(flightKey);
  }
});

// GET /api/videos/upload-status/:key — what became of an upload the app sent with this idempotency key.
// A long encode can outlast a proxy's timeout, cutting the connection after the video was in fact saved;
// the app then polls here instead of re-uploading the whole (large) file. Only the uploading session can ask.
//   { status: 'done', video }   the video exists
//   { status: 'processing' }    the server is still working on it
//   { status: 'unknown' }       nothing yet (still arriving, or it never made it)
router.get('/upload-status/:key', requireAccount, async (req: Request, res: Response) => {
  const key = String(req.params.key || '').trim().slice(0, 64);
  const sessionId = getSessionId(req);
  if (!key) {
    res.json({ status: 'unknown' });
    return;
  }
  const existing: VideoRecord | null = await prisma.video.findUnique({ where: { uploadKey: key } });
  if (existing && existing.uploaderSessionId === sessionId) {
    const uploaderMap = await fetchUploadersFor([existing], sessionId);
    res.json({ status: 'done', video: (await attachProducts([serialize(existing, undefined, existing.uploaderSessionId ? uploaderMap.get(existing.uploaderSessionId) : null)]))[0] });
    return;
  }
  res.json({ status: uploadsInFlight.has(`${sessionId}:${key}`) ? 'processing' : 'unknown' });
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

async function loadOwnedVideo(req: Request): Promise<VideoRecord> {
  const sessionId = getSessionId(req);
  const video: VideoRecord | null = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new HttpError(404, 'Video not found');
  if (!video.uploaderSessionId || video.uploaderSessionId !== sessionId) throw new HttpError(403, 'You can only edit your own videos');
  return video;
}

// GET /api/videos/:id/products — the creator's own pins including destination links (public payloads omit them).
router.get('/:id/products', requireAccount, async (req: Request, res: Response) => {
  const video = await loadOwnedVideo(req);
  const rows = await prisma.videoProduct.findMany({ where: { videoId: video.id }, orderBy: [{ position: 'asc' }, { startMs: 'asc' }] });
  res.json({ products: rows.map((p: any) => ({ id: p.id, url: p.url, title: p.title, startMs: p.startMs, endMs: p.endMs ?? null, x: p.x ?? null, y: p.y ?? null })) });
});

// PUT /api/videos/:id/products  { products: [{ url, title?, startMs?, endMs?, x?, y? }] } — creator replaces the pinned products.
router.put('/:id/products', requireAccount, writeLimiter, async (req: Request, res: Response) => {
  const video = await loadOwnedVideo(req);
  const checked = validateProducts(req.body?.products ?? [], await loadActiveSites(), video.duration ?? null);
  if ('error' in checked) throw new HttpError(400, checked.error, { code: 'INVALID_PRODUCTS' });
  await replaceVideoProducts(video.id, checked.products);
  const [withProducts] = await attachProducts([{ id: video.id }]);
  res.json({ products: withProducts.products });
});

// POST /api/videos/:id/suggest-products — AI-assisted tagging. Samples at most 3 keyframes from the
// stored video, identifies what's in each and searches the marketplace. The creator confirms or edits.
// Cost is bounded: ≤3 AI calls per request, and the heavy-upload rate limit applies.
router.post('/:id/suggest-products', requireAccount, uploadLimiter, async (req: Request, res: Response) => {
  const video = await loadOwnedVideo(req);
  if (!process.env.AI_SEARCH || !(await searchConfigured())) {
    throw new HttpError(503, 'Product suggestions are not configured on this server', { code: 'SUGGESTIONS_UNAVAILABLE' });
  }
  const input = /^https?:\/\//i.test(video.filename) ? video.filename : path.join(VIDEOS_DIR, path.basename(video.filename));
  const durationSec = video.duration ?? 10;
  const frames = await extractKeyframes(input, durationSec);

  const seen = new Set<string>();
  const suggestions: Array<{ shop?: string; title: string; url: string; image: string; price: string; startMs: number; endMs: number }> = [];
  for (const f of frames) {
    try {
      const ident = await identifyImage(f.jpeg, 'image/jpeg');
      const outcome = await searchSites(ident.text);
      for (const p of outcome.results.slice(0, 3)) {
        if (seen.has(p.listingUrl)) continue;
        seen.add(p.listingUrl);
        suggestions.push({
          shop: p.shop?.name,
          title: p.name,
          url: p.listingUrl,
          image: p.image,
          price: p.price,
          startMs: Math.max(0, f.atMs - 1500),
          endMs: Math.min(Math.ceil(durationSec * 1000), f.atMs + 3500),
        });
      }
    } catch (err) {
      console.warn(`[suggest-products] frame at ${f.atMs}ms failed`, err);
    }
  }
  res.json({ suggestions });
});

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
/**
 * Public shape of a comment. NEVER spread the database row: it carries the
 * commenter's sessionId, which on this backend is the login credential
 * (X-Session-Id), so exposing it would let anyone act as that user.
 */
function serializeComment(c: any, viewerSessionId: string, extra: { replyCount?: number; liked?: boolean } = {}) {
  return {
    id: c.id,
    videoId: c.videoId,
    author: c.author,
    text: c.text,
    parentId: c.parentId ?? null,
    likes: c.likes,
    createdAt: c.createdAt,
    mine: !!c.sessionId && c.sessionId === viewerSessionId,
    ...extra,
  };
}

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
    comments: comments.map((c: any) => serializeComment(c, sessionId, { replyCount: countByParent.get(c.id) || 0, liked: likedSet.has(c.id) })),
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
  res.json({ replies: replies.map((r: any) => serializeComment(r, sessionId, { liked: likedSet.has(r.id) })) });
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

  const [comment, updatedVideo] = await prisma.$transaction([
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

  res.status(201).json({ comment: serializeComment(comment, commenterSessionId, { replyCount: 0, liked: false }), comments: updatedVideo.comments });
});

// DELETE /api/videos/:id/comments/:commentId — the comment's author, or the owner
// of the video, may remove it (replies go with it).
router.delete('/:id/comments/:commentId', requireAccount, writeLimiter, async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const comment = await prisma.comment.findUnique({ where: { id: req.params.commentId }, include: { video: { select: { uploaderSessionId: true } } } });
  if (!comment || comment.videoId !== req.params.id) throw new HttpError(404, 'Comment not found');
  const isAuthor = !!comment.sessionId && comment.sessionId === sessionId;
  const isVideoOwner = !!comment.video?.uploaderSessionId && comment.video.uploaderSessionId === sessionId;
  if (!isAuthor && !isVideoOwner) throw new HttpError(403, 'You can only delete your own comments');
  await prisma.comment.delete({ where: { id: comment.id } });
  const count = await prisma.comment.count({ where: { videoId: comment.videoId } });
  await prisma.video.update({ where: { id: comment.videoId }, data: { comments: count } });
  res.json({ comments: count });
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
