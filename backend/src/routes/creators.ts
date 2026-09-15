import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { HttpError } from '../lib/httpError';
import { resolveAssetUrl } from './videos';
import { resolveAvatarUrl } from './profile';

const router = Router();

interface VideoForCreator {
  id: string;
  title: string;
  posterFilename: string | null;
  filename: string;
  likes: number;
  views: number;
  comments: number;
  createdAt: Date;
}

function serializeVideoSummary(v: VideoForCreator) {
  return {
    id: v.id,
    title: v.title,
    poster: v.posterFilename ? resolveAssetUrl(v.posterFilename, 'posters') : resolveAssetUrl(v.filename, 'videos'),
    likes: v.likes,
    views: v.views,
    comments: v.comments,
    createdAt: v.createdAt,
  };
}

// GET /api/creators — discover individual accounts that have uploaded
// at least one video, most videos first. Public; no session needed.
router.get('/', async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '30'), 10) || 30, 1), 100);

  const grouped = await prisma.video.groupBy({
    by: ['uploaderSessionId'],
    where: { uploaderSessionId: { not: null } },
    _count: { _all: true },
    _sum: { likes: true, views: true },
    orderBy: { _count: { uploaderSessionId: 'desc' } },
    take: limit,
  });

  const sessionIds = grouped.map((g) => g.uploaderSessionId as string);
  interface ProfileRow {
    sessionId: string;
    displayName: string | null;
    avatar: string | null;
  }
  const profiles: ProfileRow[] = await prisma.sessionProfile.findMany({ where: { sessionId: { in: sessionIds } } });
  const profileMap = new Map(profiles.map((p) => [p.sessionId, p]));

  const creators = grouped.map((g) => {
    const sessionId = g.uploaderSessionId as string;
    const profile = profileMap.get(sessionId);
    return {
      sessionId,
      displayName: profile?.displayName || null,
      avatar: profile?.avatar ? resolveAvatarUrl(profile.avatar) : null,
      videoCount: g._count._all,
      totalLikes: g._sum.likes || 0,
      totalViews: g._sum.views || 0,
    };
  });

  res.json({ creators });
});

// GET /api/creators/:sessionId — one creator's public profile: display
// name, avatar, aggregate stats, and every video they've uploaded.
router.get('/:sessionId', async (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;

  const videos: VideoForCreator[] = await prisma.video.findMany({
    where: { uploaderSessionId: sessionId },
    orderBy: { createdAt: 'desc' },
  });

  if (videos.length === 0) {
    // No profile lookup needed if there's nothing to show — a session
    // that has never uploaded isn't a discoverable creator at all,
    // regardless of whether it happens to have a SessionProfile row
    // (e.g. just an avatar set from watching, never posting).
    throw new HttpError(404, 'Creator not found');
  }

  const profile = await prisma.sessionProfile.findUnique({ where: { sessionId } });

  const totalLikes = videos.reduce((sum, v) => sum + v.likes, 0);
  const totalViews = videos.reduce((sum, v) => sum + v.views, 0);

  res.json({
    creator: {
      sessionId,
      displayName: profile?.displayName || null,
      avatar: profile?.avatar ? resolveAvatarUrl(profile.avatar) : null,
      videoCount: videos.length,
      totalLikes,
      totalViews,
    },
    videos: videos.map(serializeVideoSummary),
  });
});

export default router;
