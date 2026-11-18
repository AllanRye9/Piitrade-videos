import { Router, Response } from 'express';
import { prisma } from '../../db';
import { AuthedRequest, requirePermission } from '../../middleware/requireAdmin';
import { HttpError } from '../../lib/httpError';
import { audit } from '../../lib/audit';
import { parsePage, pageMeta } from '../../lib/pagination';
import { extractHashtags } from '../../lib/hashtags';
import { resolveAssetUrl } from '../videos';
import { VIDEOS_DIR, POSTERS_DIR } from '../../paths';
import { removeStoredFile, optionalId } from './helpers';
import { resolveProductPlan, replaceProducts } from '../../lib/videoProducts';

const router = Router();

const SORTS: Record<string, any> = {
  newest: { createdAt: 'desc' },
  oldest: { createdAt: 'asc' },
  views: { views: 'desc' },
  likes: { likes: 'desc' },
  comments: { comments: 'desc' },
};

function serialize(v: any, extra: { uploader?: any; reportCount?: number } = {}) {
  return {
    id: v.id,
    title: v.title,
    description: v.description,
    url: resolveAssetUrl(v.filename, 'videos'),
    poster: v.posterFilename ? resolveAssetUrl(v.posterFilename, 'posters') : null,
    duration: v.duration,
    size: v.size,
    likes: v.likes,
    views: v.views,
    comments: v.comments,
    shares: v.shares,
    hashtags: v.hashtags ?? [],
    createdAt: v.createdAt,
    locationId: v.locationId ?? null,
    location: v.location ? { id: v.location.id, name: v.location.name } : null,
    siteId: v.siteId ?? null,
    site: v.site ? { id: v.site.id, name: v.site.name } : null,
    productUrl: v.productUrl ?? null,
    productTitle: v.productTitle ?? null,
    products: (v.products ?? []).map((p: any) => ({ id: p.id, siteId: p.siteId, url: p.url, title: p.title, startMs: p.startMs, endMs: p.endMs, x: p.x, y: p.y })),
    uploader: extra.uploader ?? null,
    reportCount: extra.reportCount ?? 0,
  };
}

async function uploadersFor(sessionIds: string[]) {
  const ids = [...new Set(sessionIds.filter(Boolean))];
  if (!ids.length) return new Map<string, { handle: string | null; displayName: string | null; userId: string | null }>();
  const profiles = await prisma.sessionProfile.findMany({ where: { sessionId: { in: ids } }, select: { sessionId: true, handle: true, displayName: true, userId: true } });
  return new Map<string, { handle: string | null; displayName: string | null; userId: string | null }>(
    profiles.map((p: any) => [p.sessionId, { handle: p.handle, displayName: p.displayName, userId: p.userId }])
  );
}

// GET /api/admin/videos?q=&sort=&locationId=&reported=true&uploader=<userId>&page=&limit=
router.get('/', requirePermission('videos.view'), async (req: AuthedRequest, res: Response) => {
  const { page, limit, skip, take } = parsePage(req);
  const q = String(req.query.q || '').trim();
  const sort = SORTS[String(req.query.sort || 'newest')] || SORTS.newest;
  const locationId = String(req.query.locationId || '');
  const uploaderUserId = String(req.query.uploader || '');

  const where: any = {};
  if (q) {
    const tag = q.replace(/^#/, '').toLowerCase();
    const creators = await prisma.sessionProfile.findMany({
      where: { OR: [{ handle: { contains: q.replace(/^@/, ''), mode: 'insensitive' } }, { displayName: { contains: q.replace(/^@/, ''), mode: 'insensitive' } }] },
      select: { sessionId: true },
      take: 200,
    });
    where.OR = [
      { id: q },
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { hashtags: { has: tag } },
      ...(creators.length ? [{ uploaderSessionId: { in: creators.map((c: { sessionId: string }) => c.sessionId) } }] : []),
    ];
  }
  if (locationId) where.locationId = locationId;
  if (String(req.query.reported || '') === 'true') where.reportList = { some: {} };
  if (uploaderUserId) {
    const profile = await prisma.sessionProfile.findUnique({ where: { userId: uploaderUserId }, select: { sessionId: true } });
    where.uploaderSessionId = profile?.sessionId ?? '__none__';
  }

  const [total, videos] = await Promise.all([
    prisma.video.count({ where }),
    prisma.video.findMany({ where, orderBy: sort, skip, take, include: { location: true, site: true } }),
  ]);

  const ids = videos.map((v: any) => v.id as string);
  const [uploaders, reports] = await Promise.all([
    uploadersFor(videos.map((v: any) => v.uploaderSessionId as string)),
    ids.length ? prisma.report.groupBy({ by: ['videoId'], where: { videoId: { in: ids } }, _count: { _all: true } }) : Promise.resolve([]),
  ]);
  const reportCounts = new Map<string, number>(reports.map((r: any) => [r.videoId as string, r._count._all as number]));

  res.json({
    videos: videos.map((v: any) => serialize(v, { uploader: uploaders.get(v.uploaderSessionId) ?? null, reportCount: reportCounts.get(v.id) || 0 })),
    ...pageMeta(page, limit, total),
  });
});

// GET /api/admin/videos/:id
router.get('/:id', requirePermission('videos.view'), async (req: AuthedRequest, res: Response) => {
  const v = await prisma.video.findUnique({ where: { id: req.params.id }, include: { location: true, site: true, products: { orderBy: [{ startMs: 'asc' }, { position: 'asc' }] } } });
  if (!v) throw new HttpError(404, 'Video not found');
  const [uploaders, reports] = await Promise.all([
    uploadersFor([(v as any).uploaderSessionId]),
    prisma.report.findMany({ where: { videoId: v.id }, orderBy: { createdAt: 'desc' }, select: { reason: true, createdAt: true } }),
  ]);
  res.json({ video: serialize(v, { uploader: uploaders.get((v as any).uploaderSessionId) ?? null, reportCount: reports.length }), reports });
});

// PATCH /api/admin/videos/:id  { title?, description?, locationId?, products? (replaces the list), or the single-link siteId? / productUrl? / productTitle? }
router.patch('/:id', requirePermission('videos.edit'), async (req: AuthedRequest, res: Response) => {
  const title = req.body.title !== undefined ? String(req.body.title).trim().slice(0, 200) : undefined;
  if (title !== undefined && !title) throw new HttpError(400, 'A video needs a title');
  const description = req.body.description !== undefined ? String(req.body.description).slice(0, 1000) : undefined;
  const locationId = optionalId(req.body.locationId);

  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new HttpError(404, 'Video not found');

  const plan = await resolveProductPlan(req.body, video as any, video.duration ? video.duration * 1000 : null);

  try {
    const updated = await prisma.video.update({
      where: { id: video.id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(locationId !== undefined ? { locationId } : {}),
        // Re-parse whenever either changes so hashtags don't go stale.
        ...(title !== undefined || description !== undefined ? { hashtags: extractHashtags(title ?? video.title, description ?? video.description) } : {}),
      },
      include: { location: true, site: true, products: { orderBy: [{ startMs: 'asc' }, { position: 'asc' }] } },
    });
    if (plan) {
      await replaceProducts(video.id, plan);
      updated.products = (await prisma.videoProduct.findMany({ where: { videoId: video.id }, orderBy: [{ startMs: 'asc' }, { position: 'asc' }] })) as any;
    }
    audit(req, 'video.update', 'video', video.id, updated.title);
    res.json({ video: serialize(updated) });
  } catch (err: any) {
    if (err?.code === 'P2003') throw new HttpError(400, 'That location does not exist');
    throw err;
  }
});

// DELETE /api/admin/videos/:id
router.delete('/:id', requirePermission('videos.delete'), async (req: AuthedRequest, res: Response) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new HttpError(404, 'Video not found');

  await prisma.video.delete({ where: { id: video.id } });
  // The row is already gone; a storage hiccup (R2 down, file missing) must not turn a successful delete into a 500.
  await removeStoredFile(video.filename, VIDEOS_DIR).catch((err: unknown) => console.error('video file cleanup failed', err));
  if (video.posterFilename) await removeStoredFile(video.posterFilename, POSTERS_DIR).catch((err: unknown) => console.error('poster cleanup failed', err));
  audit(req, 'video.delete', 'video', video.id, video.title);
  res.status(204).send();
});

// GET /api/admin/videos/:id/comments
router.get('/:id/comments', requirePermission('comments.view'), async (req: AuthedRequest, res: Response) => {
  const comments = await prisma.comment.findMany({ where: { videoId: req.params.id }, orderBy: { createdAt: 'desc' } });
  res.json({ comments });
});

export default router;
