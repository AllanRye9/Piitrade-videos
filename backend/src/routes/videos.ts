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
  createdAt: Date;
};

type StateRecord = { videoId: string; liked: boolean; favorited: boolean; saved: boolean };

function getSessionId(req: Request): string {
  const id = req.header('x-session-id');
  return id && id.trim() ? id.trim() : 'anonymous';
}

// A stored filename is either a local disk filename (served from
// /uploads/...) or, when VIDEO_STORE is configured, the full ImageKit
// URL returned at upload time. Both are valid values of the same
// `filename`/`posterFilename` DB columns — this just decides how to
// turn whichever one is stored into a URL the frontend can use as-is.
function resolveAssetUrl(value: string, localDir: 'videos' | 'posters'): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `/uploads/${localDir}/${value}`;
}

function serialize(video: VideoRecord, state?: StateRecord) {
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
    createdAt: video.createdAt,
    liked: state?.liked ?? false,
    favorited: state?.favorited ?? false,
    saved: state?.saved ?? false,
  };
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

// GET /api/videos
router.get('/', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const videos: VideoRecord[] = await prisma.video.findMany({ orderBy: { createdAt: 'desc' } });
  const stateMap = await fetchStatesFor(videos.map((v) => v.id), sessionId);
  res.json({ videos: videos.map((v) => serialize(v, stateMap.get(v.id))) });
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
  });
  const stateMap = await fetchStatesFor(videos.map((v) => v.id), sessionId);
  res.json({ videos: videos.map((v) => serialize(v, stateMap.get(v.id))) });
});

// GET /api/videos/:id
router.get('/:id', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const video: VideoRecord | null = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new HttpError(404, 'Video not found');

  const updated = await prisma.video.update({ where: { id: video.id }, data: { views: { increment: 1 } } });
  const stateMap = await fetchStatesFor([video.id], sessionId);
  res.json({ video: serialize(updated, stateMap.get(video.id)) });
});

// POST /api/videos  (multipart: video, title, description)
router.post('/', uploadVideo.single('video'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw new HttpError(400, 'No video file uploaded');

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

  const video = await prisma.video.create({
    data: {
      title,
      description,
      filename: finalVideoFilename,
      posterFilename: finalPosterFilename,
      mimeType: 'video/mp4', // always true post-transcode, regardless of the original upload's format
      size: transcodedSize,
      duration,
    },
  });

  res.status(201).json({ video: serialize(video) });
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

// GET /api/videos/:id/comments
router.get('/:id/comments', async (req: Request, res: Response) => {
  const comments = await prisma.comment.findMany({
    where: { videoId: req.params.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ comments });
});

// POST /api/videos/:id/comments  { text, author? }
router.post('/:id/comments', async (req: Request, res: Response) => {
  const text = String(req.body.text || '').trim().slice(0, 500);
  if (!text) throw new HttpError(400, 'Comment text is required');

  const author = String(req.body.author || 'Guest').slice(0, 60);
  const videoId = req.params.id;

  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) throw new HttpError(404, 'Video not found');

  const [comment] = await prisma.$transaction([
    prisma.comment.create({ data: { videoId, author, text } }),
    prisma.video.update({ where: { id: videoId }, data: { comments: { increment: 1 } } }),
  ]);

  res.status(201).json({ comment, comments: video.comments + 1 });
});

export default router;
