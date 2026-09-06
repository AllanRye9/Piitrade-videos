import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { prisma } from '../db';
import { uploadVideo } from '../middleware/upload';
import { extractPoster, getVideoDuration } from '../lib/thumbnail';
import { POSTERS_DIR, VIDEOS_DIR } from '../paths';

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

function getSessionId(req: Request): string {
  const id = req.header('x-session-id');
  return id && id.trim() ? id.trim() : 'anonymous';
}

async function serializeVideo(video: VideoRecord, sessionId: string) {
  const state = await prisma.userVideoState.findUnique({
    where: { sessionId_videoId: { sessionId, videoId: video.id } },
  });
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

// GET /api/videos
router.get('/', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const videos = await prisma.video.findMany({ orderBy: { createdAt: 'desc' } });
  const serialized = await Promise.all(videos.map((v: VideoRecord) => serializeVideo(v, sessionId)));
  res.json({ videos: serialized });
});

// GET /api/videos/search?q=
router.get('/search', async (req: Request, res: Response) => {
  const q = String(req.query.q || '').trim();
  const sessionId = getSessionId(req);
  if (!q) {
    res.json({ videos: [] });
    return;
  }
  const videos = await prisma.video.findMany({
    where: {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
  const serialized = await Promise.all(videos.map((v: VideoRecord) => serializeVideo(v, sessionId)));
  res.json({ videos: serialized });
});

// GET /api/videos/:id
router.get('/:id', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  await prisma.video.update({ where: { id: video.id }, data: { views: { increment: 1 } } });
  res.json({ video: await serializeVideo({ ...video, views: video.views + 1 }, sessionId) });
});

// POST /api/videos  (multipart: video, title, description)
router.post('/', uploadVideo.single('video'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No video file uploaded' });
    return;
  }
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
    data: {
      title,
      description,
      filename: file.filename,
      posterFilename,
      mimeType: file.mimetype,
      size: file.size,
      duration,
    },
  });

  res.status(201).json({ video: await serializeVideo(video, getSessionId(req)) });
});

// DELETE /api/videos/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  await prisma.video.delete({ where: { id: video.id } });
  const videoFile = path.join(VIDEOS_DIR, video.filename);
  if (fs.existsSync(videoFile)) fs.unlinkSync(videoFile);
  if (video.posterFilename) {
    const posterFile = path.join(POSTERS_DIR, video.posterFilename);
    if (fs.existsSync(posterFile)) fs.unlinkSync(posterFile);
  }
  res.status(204).send();
});

async function toggleState(field: 'liked' | 'favorited' | 'saved', likeDelta: 0 | 1 | -1 = 0) {
  return async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    const videoId = req.params.id;
    const video = await prisma.video.findUnique({ where: { id: videoId } });
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }
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

router.post('/:id/like', async (req, res) => (await toggleState('liked'))(req, res));
router.post('/:id/favorite', async (req, res) => (await toggleState('favorited'))(req, res));
router.post('/:id/save', async (req, res) => (await toggleState('saved'))(req, res));

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
  if (!text) {
    res.status(400).json({ error: 'Comment text is required' });
    return;
  }
  const author = String(req.body.author || 'Guest').slice(0, 60);
  const videoId = req.params.id;

  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }

  const [comment] = await prisma.$transaction([
    prisma.comment.create({ data: { videoId, author, text } }),
    prisma.video.update({ where: { id: videoId }, data: { comments: { increment: 1 } } }),
  ]);

  res.status(201).json({ comment, comments: video.comments + 1 });
});

export default router;
