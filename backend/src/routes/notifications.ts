import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { resolveAvatarUrl } from './profile';
import { resolveAssetUrl, getSessionId } from './videos';
import { writeLimiter } from '../middleware/rateLimit';

const router = Router();

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

type NotificationRecord = {
  id: string;
  type: string;
  actorSessionId: string;
  videoId: string | null;
  commentText: string | null;
  read: boolean;
  createdAt: Date;
};

type ActorRecord = { sessionId: string; handle: string | null; displayName: string | null; avatar: string | null };

/**
 * Batch-resolves actor handle/displayName/avatar for a page of
 * notifications in one query, same N+1-avoidance rationale as
 * fetchUploadersFor() in routes/videos.ts. An actor who never claimed
 * a handle (shouldn't happen for follow/comment triggers, since both
 * require the actor to be a real, identifiable session, but handled
 * defensively) just renders as "Someone".
 */
async function fetchActorsFor(notifications: NotificationRecord[]): Promise<Map<string, ActorRecord>> {
  const sessionIds = [...new Set(notifications.map((n) => n.actorSessionId))];
  if (sessionIds.length === 0) return new Map();
  const profiles = await prisma.sessionProfile.findMany({ where: { sessionId: { in: sessionIds } } });
  return new Map(
    profiles.map((p: { sessionId: string; handle: string | null; displayName: string | null; avatar: string | null }) => [
      p.sessionId,
      { sessionId: p.sessionId, handle: p.handle, displayName: p.displayName, avatar: p.avatar ? resolveAvatarUrl(p.avatar) : null },
    ])
  );
}

async function fetchVideosFor(notifications: NotificationRecord[]): Promise<Map<string, { id: string; title: string; posterFilename: string | null }>> {
  const videoIds = [...new Set(notifications.map((n) => n.videoId).filter((id): id is string => !!id))];
  if (videoIds.length === 0) return new Map();
  const videos = await prisma.video.findMany({ where: { id: { in: videoIds } } });
  return new Map(videos.map((v: { id: string; title: string; posterFilename: string | null }) => [v.id, v]));
}

function serialize(n: NotificationRecord, actor?: ActorRecord, video?: { id: string; title: string; posterFilename: string | null }) {
  return {
    id: n.id,
    type: n.type,
    read: n.read,
    createdAt: n.createdAt,
    commentText: n.commentText,
    actor: actor?.handle ? { handle: actor.handle, displayName: actor.displayName, avatar: actor.avatar } : { handle: null, displayName: null, avatar: null },
    video: video ? { id: video.id, title: video.title, poster: video.posterFilename ? resolveAssetUrl(video.posterFilename, 'posters') : null } : null,
  };
}

// GET /api/notifications?cursor=&limit=  — this session's own
// notifications, newest first, cursor-paginated the same way the main
// feed is (see routes/videos.ts) rather than fetching everything.
router.get('/', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : undefined;
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.limit) || DEFAULT_PAGE_SIZE));

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { recipientSessionId: sessionId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    prisma.notification.count({ where: { recipientSessionId: sessionId, read: false } }),
  ]);
  const hasMore = notifications.length > limit;
  const page = hasMore ? notifications.slice(0, limit) : notifications;

  const [actors, videos] = await Promise.all([fetchActorsFor(page), fetchVideosFor(page)]);

  res.json({
    notifications: page.map((n: NotificationRecord) =>
      serialize(n, actors.get(n.actorSessionId), n.videoId ? videos.get(n.videoId) : undefined)
    ),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    unreadCount,
  });
});

// POST /api/notifications/read-all — called when the notification
// panel opens (see NotificationsPanel.tsx). Marks everything read
// rather than tracking per-item read state from the frontend, which
// matches how most notification centers actually behave (open the
// list = you've seen it) and keeps the client simple.
router.post('/read-all', writeLimiter, async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  await prisma.notification.updateMany({ where: { recipientSessionId: sessionId, read: false }, data: { read: true } });
  res.json({ ok: true });
});

export default router;
