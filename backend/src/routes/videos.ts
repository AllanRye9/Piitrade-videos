import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { prisma } from '../db';
import { uploadVideo } from '../middleware/upload';
import { extractPoster, getVideoDuration } from '../lib/thumbnail';
import { POSTERS_DIR } from '../paths';
import { HttpError } from '../lib/httpError';

const router = Router();

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

function serialize(video: VideoRecord, state?: StateRecord) {
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    url: `/uploads/videos/${video.filename}`,
    poster: video.posterFilename ? `/uploads/posters/${video.posterFilename}` : null,
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

  let posterFilename: string | null = null;
  let duration: number | null = null;
  try {
    duration = await getVideoDuration(file.path);
    const posterName = `${path.parse(file.filename).name}.jpg`;
    await extractPoster(file.path, POSTERS_DIR, posterName);
    if (fs.existsSync(path.join(POSTERS_DIR, posterName))) {
      posterFilename = posterName;
    }
  } catch (err) {
    // Poster generation is best-effort — the video still saves without one.
    console.warn('Poster generation failed:', (err as Error).message);
  }

  const video = await prisma.video.create({
    data: { title, description, filename: file.filename, posterFilename, mimeType: file.mimetype, size: file.size, duration },
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
