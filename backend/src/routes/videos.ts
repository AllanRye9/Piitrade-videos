import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { prisma } from '../db';
import { uploadVideo } from '../middleware/upload';
import { extractPoster, getVideoDuration } from '../lib/thumbnail';
import { transcodeToMp4 } from '../lib/videoTranscode';
import { uploadToStore } from '../lib/imagekit';
import { VIDEOS_DIR, POSTERS_DIR } from '../paths';
import { HttpError } from '../lib/httpError';
import { ensureHandle, resolveAvatarUrl } from './profile';
import { uploadLimiter, writeLimiter } from '../middleware/rateLimit';
import { extractHashtags } from '../lib/hashtags';

const router = Router();

// Enforced server-side (in addition to the instant client-side check)
// since the client can't be trusted — never rely on it alone.
const MAX_DURATION_SECONDS = 60;

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

type UploaderRecord = { sessionId: string; handle: string | null; displayName: string | null; avatar: string | null };

export function getSessionId(req: Request): string {
  const id = req.header('x-session-id');
  return id && id.trim() ? id.trim() : 'anonymous';
}

// A stored filename is either a local disk filename (served from
// /uploads/...) or, when VIDEO_STORE is configured, the full ImageKit
// URL returned at upload time. Both are valid values of the same
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
    uploader: uploader?.handle ? { handle: uploader.handle, displayName: uploader.displayName, avatar: uploader.avatar } : null,
  };
}

/**
 * Batch-fetches public uploader info (handle/displayName/avatar) for a
 * list of videos in a single query, same N+1-avoidance rationale as
 * fetchStatesFor() below. Videos uploaded before uploaderSessionId
 * existed, or whose uploader never claimed a public handle, simply
 * have no entry in the returned map.
 */
async function fetchUploadersFor(videos: VideoRecord[]): Promise<Map<string, UploaderRecord>> {
  const sessionIds = [...new Set(videos.map((v) => v.uploaderSessionId).filter((id): id is string => !!id))];
  if (sessionIds.length === 0) return new Map();
  const profiles = await prisma.sessionProfile.findMany({ where: { sessionId: { in: sessionIds }, handle: { not: null } } });
  return new Map(
    profiles.map((p: { sessionId: string; handle: string | null; displayName: string | null; avatar: string | null }) => [
      p.sessionId,
      { sessionId: p.sessionId, handle: p.handle, displayName: p.displayName, avatar: p.avatar ? resolveAvatarUrl(p.avatar) : null },
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
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : undefined;
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.limit) || DEFAULT_PAGE_SIZE));

  const videos: VideoRecord[] = await prisma.video.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit + 1, // fetch one extra to know whether there's a next page
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = videos.length > limit;
  const page = hasMore ? videos.slice(0, limit) : videos;

  const stateMap = await fetchStatesFor(page.map((v) => v.id), sessionId);
  const uploaderMap = await fetchUploadersFor(page);
  res.json({
    videos: page.map((v) => serialize(v, stateMap.get(v.id), v.uploaderSessionId ? uploaderMap.get(v.uploaderSessionId) : null)),
    nextCursor: hasMore ? page[page.length - 1].id : null,
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
  const uploaderMap = await fetchUploadersFor(ordered);
  res.json({
    videos: ordered.map((v: VideoRecord) => serialize(v, stateMap.get(v.id), v.uploaderSessionId ? uploaderMap.get(v.uploaderSessionId) : null)),
  });
});

// GET /api/videos/search?q=
router.get('/search', async (req: Request, res: Response) => {
  const q = String(req.query.q || '').trim();
  const sessionId = getSessionId(req);
  if (!q) {
    res.json({ videos: [] });
    return;
  }
  const videos: VideoRecord[] = await prisma.video.findMany({
    where: {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_PAGE_SIZE, // safety cap — search has no pagination UI, just bounded results
  });
  const stateMap = await fetchStatesFor(videos.map((v) => v.id), sessionId);
  const uploaderMap = await fetchUploadersFor(videos);
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
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : undefined;
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.limit) || DEFAULT_PAGE_SIZE));

  const videos: VideoRecord[] = await prisma.video.findMany({
    where: { hashtags: { has: tag } },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = videos.length > limit;
  const page = hasMore ? videos.slice(0, limit) : videos;

  const stateMap = await fetchStatesFor(page.map((v) => v.id), sessionId);
  const uploaderMap = await fetchUploadersFor(page);
  res.json({
    tag,
    videos: page.map((v) => serialize(v, stateMap.get(v.id), v.uploaderSessionId ? uploaderMap.get(v.uploaderSessionId) : null)),
    nextCursor: hasMore ? page[page.length - 1].id : null,
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

// GET /api/videos/:id
router.get('/:id', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const video: VideoRecord | null = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new HttpError(404, 'Video not found');

  const updated = await prisma.video.update({ where: { id: video.id }, data: { views: { increment: 1 } } });
  const stateMap = await fetchStatesFor([video.id], sessionId);
  const uploaderMap = await fetchUploadersFor([updated]);
  res.json({ video: serialize(updated, stateMap.get(video.id), updated.uploaderSessionId ? uploaderMap.get(updated.uploaderSessionId) : null) });
});

// POST /api/videos  (multipart: video, title, description)
router.post('/', uploadLimiter, uploadVideo.single('video'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw new HttpError(400, 'No video file uploaded');

  const sessionId = getSessionId(req);
  const title = String(req.body.title || 'Untitled').slice(0, 200);
  const description = String(req.body.description || '').slice(0, 1000);

  // Read the duration first, before doing any (comparatively expensive)
  // transcode/poster work — an over-length or unreadable clip is
  // rejected immediately instead of wasting an ffmpeg pass on a file
  // we're about to delete anyway. ffprobe reads this straight from the
  // container regardless of format, so this works for every format
  // middleware/upload.ts accepts, not just mp4.
  const duration = await getVideoDuration(file.path);
  if (duration === null) {
    fs.unlinkSync(file.path);
    throw new HttpError(422, 'Could not read this video — please upload a valid video file');
  }
  if (duration > MAX_DURATION_SECONDS) {
    fs.unlinkSync(file.path);
    throw new HttpError(400, `Videos must be ${MAX_DURATION_SECONDS} seconds or less (this one is ${Math.round(duration)}s)`);
  }

  // Normalize every upload to H.264/AAC MP4, whatever format it
  // arrived in. This guarantees the stored file is playable in every
  // browser's <video> tag and that its audio track is explicitly
  // preserved (never re-encoded with -an) — see lib/videoTranscode.ts.
  const transcodedFilename = `${uuid()}.mp4`;
  const transcodedPath = path.join(VIDEOS_DIR, transcodedFilename);
  try {
    await transcodeToMp4(file.path, transcodedPath);
  } catch (err) {
    fs.unlinkSync(file.path);
    if (fs.existsSync(transcodedPath)) fs.unlinkSync(transcodedPath);
    console.error('Video transcode failed:', (err as Error).message);
    throw new HttpError(422, 'Could not process this video — please upload a valid video file');
  } finally {
    // The original upload (whatever format it was) is never served —
    // only the normalized transcodedPath is, from here on.
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
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
  // disk filename or a full ImageKit URL — see serialize()'s
  // resolveAssetUrl(), which handles either transparently. When
  // VIDEO_STORE is configured, upload succeeds, and local copies are
  // removed since ImageKit is now the source of truth; on any failure
  // (not configured, or the upload call itself fails) the local files
  // stay in place and are served locally instead, so a misconfigured
  // or briefly-down ImageKit account never blocks a video posting.
  let finalVideoFilename: string = transcodedFilename;
  let finalPosterFilename: string | null = posterFilename;
  try {
    const videoBuffer = fs.readFileSync(transcodedPath);
    const uploaded = await uploadToStore('VIDEO_STORE', videoBuffer, transcodedFilename, 'videos');
    if (uploaded) {
      finalVideoFilename = uploaded.url;
      fs.unlinkSync(transcodedPath);

      if (posterFilename) {
        const posterBuffer = fs.readFileSync(path.join(POSTERS_DIR, posterFilename));
        const uploadedPoster = await uploadToStore('VIDEO_STORE', posterBuffer, posterFilename, 'posters');
        if (uploadedPoster) {
          finalPosterFilename = uploadedPoster.url;
          fs.unlinkSync(path.join(POSTERS_DIR, posterFilename));
        }
      }
    }
  } catch (err) {
    // VIDEO_STORE is configured but the upload itself failed (network,
    // auth, quota, etc). Fall back to the local copies already on disk
    // rather than losing the upload the viewer just waited for.
    console.warn('VIDEO_STORE upload failed, keeping local copy:', err instanceof Error ? err.message : err);
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
    },
  });

  const uploaderMap = await fetchUploadersFor([video]);
  res.status(201).json({ video: serialize(video, undefined, video.uploaderSessionId ? uploaderMap.get(video.uploaderSessionId) : null) });
});

function makeToggleHandler(field: 'liked' | 'favorited' | 'saved') {
  return async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    const videoId = req.params.id;
    const video = await prisma.video.findUnique({ where: { id: videoId } });
    if (!video) throw new HttpError(404, 'Video not found');

    const existing = await prisma.userVideoState.findUnique({
      where: { sessionId_videoId: { sessionId, videoId } },
    });
    const newValue = !(existing?.[field] ?? false);

    await prisma.userVideoState.upsert({
      where: { sessionId_videoId: { sessionId, videoId } },
      create: { sessionId, videoId, [field]: newValue },
      update: { [field]: newValue },
    });

    let likes = video.likes;
    if (field === 'liked') {
      likes = video.likes + (newValue ? 1 : -1);
      await prisma.video.update({ where: { id: videoId }, data: { likes } });
    }

    res.json({ [field]: newValue, likes });
  };
}

router.post('/:id/like', makeToggleHandler('liked'));
router.post('/:id/favorite', makeToggleHandler('favorited'));
router.post('/:id/save', makeToggleHandler('saved'));

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
router.post('/:id/comments/:commentId/like', writeLimiter, async (req: Request, res: Response) => {
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
router.post('/:id/comments', writeLimiter, async (req: Request, res: Response) => {
  const text = String(req.body.text || '').trim().slice(0, 500);
  if (!text) throw new HttpError(400, 'Comment text is required');

  const author = String(req.body.author || 'Guest').slice(0, 60);
  const videoId = req.params.id;
  const commenterSessionId = getSessionId(req);
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
router.post('/:id/report', writeLimiter, async (req: Request, res: Response) => {
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
