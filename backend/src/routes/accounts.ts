import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { resolveAvatarUrl } from './profile';
import { resolveAssetUrl, getSessionId } from './videos';
import { HttpError } from '../lib/httpError';
import { writeLimiter } from '../middleware/rateLimit';

const router = Router();

// Public accounts are any SessionProfile that has claimed a handle —
// claiming happens automatically the moment a session posts its first
// video (see ensureHandle() in routes/profile.ts) — so "discoverable"
// here effectively means "has uploaded at least once".
type PublicProfile = { sessionId: string; handle: string | null; displayName: string | null; avatar: string | null; bio: string | null };

function serializeAccountSummary(
  profile: PublicProfile,
  videoCount: number,
  totalLikes: number,
  followersCount: number,
  followingCount?: number,
  isFollowing?: boolean
) {
  return {
    handle: profile.handle,
    displayName: profile.displayName,
    avatar: profile.avatar ? resolveAvatarUrl(profile.avatar) : null,
    bio: profile.bio,
    videoCount,
    totalLikes,
    followersCount,
    // Omitted (rather than 0) on the discover list, where computing a
    // viewer's own following-count for every row isn't worth the
    // extra query — only the single-account page needs it.
    ...(followingCount !== undefined ? { followingCount } : {}),
    ...(isFollowing !== undefined ? { isFollowing } : {}),
  };
}

// GET /api/accounts?q=  — discoverable creators, optionally filtered by
// handle/display name. Ordered by video count so active uploaders surface first.
router.get('/', async (req: Request, res: Response) => {
  const q = String(req.query.q || '').trim();
  const profiles: PublicProfile[] = await prisma.sessionProfile.findMany({
    where: {
      handle: { not: null },
      ...(q
        ? {
            OR: [
              { handle: { contains: q, mode: 'insensitive' } },
              { displayName: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
  });
  if (profiles.length === 0) {
    res.json({ accounts: [] });
    return;
  }

  const sessionIds = profiles.map((p) => p.sessionId);
  const [grouped, followerGroups] = await Promise.all([
    prisma.video.groupBy({
      by: ['uploaderSessionId'],
      where: { uploaderSessionId: { in: sessionIds } },
      _count: { _all: true },
      _sum: { likes: true },
    }),
    prisma.follow.groupBy({
      by: ['followingSessionId'],
      where: { followingSessionId: { in: sessionIds } },
      _count: { _all: true },
    }),
  ]);
  const statsBySession = new Map<string | null, { count: number; likes: number }>(
    grouped.map((g: { uploaderSessionId: string | null; _count: { _all: number }; _sum: { likes: number | null } }) => [
      g.uploaderSessionId,
      { count: g._count._all, likes: g._sum.likes || 0 },
    ])
  );
  const followersBySession = new Map<string, number>(
    followerGroups.map((g: { followingSessionId: string; _count: { _all: number } }) => [g.followingSessionId, g._count._all])
  );

  const accounts = profiles
    .map((p) => {
      const stats = statsBySession.get(p.sessionId);
      return serializeAccountSummary(p, stats?.count || 0, stats?.likes || 0, followersBySession.get(p.sessionId) || 0);
    })
    // A session can claim a handle without ever finishing an upload
    // (e.g. ensureHandle() is also reachable independently) — those
    // aren't meaningfully "discoverable" yet, so leave them out.
    .filter((a) => a.videoCount > 0)
    .sort((a, b) => b.videoCount - a.videoCount);

  res.json({ accounts });
});

// GET /api/accounts/:handle — public profile + this creator's uploaded videos
router.get('/:handle', async (req: Request, res: Response) => {
  const handle = req.params.handle.toLowerCase();
  const sessionId = getSessionId(req);
  const profile: PublicProfile | null = await prisma.sessionProfile.findUnique({ where: { handle } });
  if (!profile) throw new HttpError(404, 'Account not found');

  const [videos, followersCount, followingCount, existingFollow] = await Promise.all([
    prisma.video.findMany({ where: { uploaderSessionId: profile.sessionId }, orderBy: { createdAt: 'desc' } }),
    prisma.follow.count({ where: { followingSessionId: profile.sessionId } }),
    prisma.follow.count({ where: { followerSessionId: profile.sessionId } }),
    prisma.follow.findUnique({ where: { followerSessionId_followingSessionId: { followerSessionId: sessionId, followingSessionId: profile.sessionId } } }),
  ]);
  const totalLikes = videos.reduce((sum: number, v: { likes: number }) => sum + v.likes, 0);

  const states = await prisma.userVideoState.findMany({
    where: { sessionId, videoId: { in: videos.map((v: { id: string }) => v.id) } },
  });
  const stateMap = new Map(states.map((s: { videoId: string; liked: boolean; favorited: boolean; saved: boolean }) => [s.videoId, s]));

  res.json({
    account: serializeAccountSummary(profile, videos.length, totalLikes, followersCount, followingCount, !!existingFollow),
    videos: videos.map((v: any) => {
      const state = stateMap.get(v.id);
      return {
        id: v.id,
        title: v.title,
        description: v.description,
        url: resolveAssetUrl(v.filename, 'videos'),
        poster: v.posterFilename ? resolveAssetUrl(v.posterFilename, 'posters') : null,
        duration: v.duration,
        likes: v.likes,
        views: v.views,
        comments: v.comments,
        shares: v.shares,
        hashtags: v.hashtags || [],
        createdAt: v.createdAt,
        liked: (state as any)?.liked ?? false,
        favorited: (state as any)?.favorited ?? false,
        saved: (state as any)?.saved ?? false,
        uploader: { handle: profile.handle, displayName: profile.displayName, avatar: profile.avatar ? resolveAvatarUrl(profile.avatar) : null },
      };
    }),
  });
});

// POST /api/accounts/:handle/follow — toggle follow. Same
// toggle-on-repeat-call shape as /like, /favorite, /save in
// routes/videos.ts: calling it again just undoes it, so the frontend
// doesn't need to track direction, only the returned `following` state.
router.post('/:handle/follow', writeLimiter, async (req: Request, res: Response) => {
  const handle = req.params.handle.toLowerCase();
  const followerSessionId = getSessionId(req);

  const profile: PublicProfile | null = await prisma.sessionProfile.findUnique({ where: { handle } });
  if (!profile) throw new HttpError(404, 'Account not found');
  if (profile.sessionId === followerSessionId) throw new HttpError(400, "You can't follow your own account");

  const key = { followerSessionId_followingSessionId: { followerSessionId, followingSessionId: profile.sessionId } };
  const existing = await prisma.follow.findUnique({ where: key });

  if (existing) {
    await prisma.follow.delete({ where: key });
  } else {
    await prisma.follow.create({ data: { followerSessionId, followingSessionId: profile.sessionId } });
    // Notify the followed account — but not on unfollow, and this
    // branch only runs when `existing` was null, i.e. this is a new
    // follow, not a repeat toggle back to the same state.
    await prisma.notification.create({
      data: { recipientSessionId: profile.sessionId, type: 'follow', actorSessionId: followerSessionId },
    });
  }

  const followersCount = await prisma.follow.count({ where: { followingSessionId: profile.sessionId } });
  res.json({ following: !existing, followersCount });
});

export default router;
