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
import { loadActiveSites, replaceVideoProducts } from '../../lib/videoProducts';
import { validateProducts } from '../../lib/shoppable';

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
    hidden: !!v.hidden,
    hiddenAt: v.hiddenAt ?? null,
    pinRank: v.pinRank ?? null,
    hashtags: v.hashtags ?? [],
    createdAt: v.createdAt,
    locationId: v.locationId ?? null,
    location: v.location ? { id: v.location.id, name: v.location.name } : null,
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
  const sort = String(req.query.status || '') === 'pinned' ? [{ pinRank: 'asc' }, { createdAt: 'desc' }] : SORTS[String(req.query.sort || 'newest')] || SORTS.newest;
  const locationId = String(req.query.locationId || '');
  const uploaderUserId = String(req.query.uploader || '');

  const where: any = {};
  const status = String(req.query.status || '');
  if (status === 'hidden') where.hidden = true;
  else if (status === 'visible') where.hidden = false;
  else if (status === 'pinned') where.pinRank = { not: null };
  if (q) where.OR = [{ title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }];
  if (locationId) where.locationId = locationId;
  if (String(req.query.reported || '') === 'true') where.reportList = { some: {} };
  if (uploaderUserId) {
    const profile = await prisma.sessionProfile.findUnique({ where: { userId: uploaderUserId }, select: { sessionId: true } });
    where.uploaderSessionId = profile?.sessionId ?? '__none__';
  }

  const [total, videos] = await Promise.all([
    prisma.video.count({ where }),
    prisma.video.findMany({ where, orderBy: sort, skip, take, include: { location: true } }),
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
  const v = await prisma.video.findUnique({ where: { id: req.params.id }, include: { location: true } });
  if (!v) throw new HttpError(404, 'Video not found');
  const [uploaders, reports] = await Promise.all([
    uploadersFor([(v as any).uploaderSessionId]),
    prisma.report.findMany({ where: { videoId: v.id }, orderBy: { createdAt: 'desc' }, select: { reason: true, createdAt: true } }),
  ]);
  res.json({ video: serialize(v, { uploader: uploaders.get((v as any).uploaderSessionId) ?? null, reportCount: reports.length }), reports });
});

// PATCH /api/admin/videos/:id  { title?, description?, locationId? }
router.patch('/:id', requirePermission('videos.edit'), async (req: AuthedRequest, res: Response) => {
  const title = req.body.title !== undefined ? String(req.body.title).slice(0, 200) : undefined;
  const description = req.body.description !== undefined ? String(req.body.description).slice(0, 1000) : undefined;
  const locationId = optionalId(req.body.locationId);

  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new HttpError(404, 'Video not found');

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
      include: { location: true },
    });
    audit(req, 'video.update', 'video', video.id, updated.title);
    res.json({ video: serialize(updated) });
  } catch (err: any) {
    if (err?.code === 'P2003') throw new HttpError(400, 'That location does not exist');
    throw err;
  }
});

// ---- Visibility & feed position -------------------------------------------
// Hidden videos disappear from every public surface (feed, trending, search,
// hashtags, profiles, permalink/embed, notifications) but stay in the database and
// in this admin list, so hiding is reversible. Pinned videos sit at the top of the
// Latest feed in pinRank order (lower first). A hidden video can't be pinned.
const MAX_PINNED = 20;

// POST /api/admin/videos/:id/hide  — also drops any pin
router.post('/:id/hide', requirePermission('videos.edit'), async (req: AuthedRequest, res: Response) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new HttpError(404, 'Video not found');
  const updated = await prisma.video.update({ where: { id: video.id }, data: { hidden: true, hiddenAt: new Date(), pinRank: null }, include: { location: true } });
  audit(req, 'video.hide', 'video', video.id, video.title);
  res.json({ video: serialize(updated) });
});

// POST /api/admin/videos/:id/unhide
router.post('/:id/unhide', requirePermission('videos.edit'), async (req: AuthedRequest, res: Response) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new HttpError(404, 'Video not found');
  const updated = await prisma.video.update({ where: { id: video.id }, data: { hidden: false, hiddenAt: null }, include: { location: true } });
  audit(req, 'video.unhide', 'video', video.id, video.title);
  res.json({ video: serialize(updated) });
});

// PUT /api/admin/videos/pins/order  { ids: [videoId, ...] } — the complete pinned list, top first
router.put('/pins/order', requirePermission('videos.edit'), async (req: AuthedRequest, res: Response) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Duplicate video in order');
  const pinned = await prisma.video.findMany({ where: { pinRank: { not: null } }, select: { id: true } });
  const have = new Set<string>(pinned.map((v: any) => v.id));
  if (ids.length !== have.size || ids.some((id) => !have.has(id))) throw new HttpError(400, 'Order must list exactly the pinned videos', { code: 'PIN_ORDER_MISMATCH' });
  await Promise.all(ids.map((id, i) => prisma.video.update({ where: { id }, data: { pinRank: i } })));
  audit(req, 'video.reorder', 'video', 'pins', `${ids.length} pinned`);
  res.json({ ids });
});

// PUT /api/admin/videos/:id/pin  { pinned: boolean, position?: number }
// pinned:true appends to the bottom of the pinned list (or inserts at `position`, 0-based).
router.put('/:id/pin', requirePermission('videos.edit'), async (req: AuthedRequest, res: Response) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new HttpError(404, 'Video not found');
  const want = req.body?.pinned !== false;
  const pinned: any[] = await prisma.video.findMany({ where: { pinRank: { not: null } }, orderBy: [{ pinRank: 'asc' }, { createdAt: 'desc' }], select: { id: true } });
  const order: string[] = pinned.map((v) => v.id).filter((id: string) => id !== video.id);
  if (want) {
    if ((video as any).hidden) throw new HttpError(400, 'Unhide the video before pinning it', { code: 'VIDEO_HIDDEN' });
    if (order.length >= MAX_PINNED) throw new HttpError(400, `At most ${MAX_PINNED} videos can be pinned`, { code: 'PIN_LIMIT' });
    const pos = Number.isInteger(req.body?.position) ? Math.min(Math.max(req.body.position, 0), order.length) : order.length;
    order.splice(pos, 0, video.id);
  }
  await Promise.all(order.map((id, i) => prisma.video.update({ where: { id }, data: { pinRank: i } })));
  if (!want) await prisma.video.update({ where: { id: video.id }, data: { pinRank: null } });
  audit(req, want ? 'video.pin' : 'video.unpin', 'video', video.id, video.title);
  res.json({ pinned: want, ids: order });
});

// GET /api/admin/videos/:id/products — full rows (with destination URLs) for the editor
router.get('/:id/products', requirePermission('videos.view'), async (req: AuthedRequest, res: Response) => {
  const rows = await prisma.videoProduct.findMany({ where: { videoId: req.params.id }, orderBy: [{ position: 'asc' }, { startMs: 'asc' }], include: { site: { select: { name: true } } } });
  res.json({ products: rows.map((p: any) => ({ id: p.id, url: p.url, title: p.title, startMs: p.startMs, endMs: p.endMs, x: p.x, y: p.y, site: p.site?.name ?? '' })) });
});

// PUT /api/admin/videos/:id/products  { products: [...] } — same validation as the creator endpoint
router.put('/:id/products', requirePermission('videos.edit'), async (req: AuthedRequest, res: Response) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new HttpError(404, 'Video not found');
  const checked = validateProducts(req.body?.products ?? [], await loadActiveSites(), video.duration ?? null);
  if ('error' in checked) throw new HttpError(400, checked.error);
  await replaceVideoProducts(video.id, checked.products);
  audit(req, 'video.products', 'video', video.id, `${checked.products.length} product(s)`);
  res.json({ count: checked.products.length });
});

// DELETE /api/admin/videos/:id
router.delete('/:id', requirePermission('videos.delete'), async (req: AuthedRequest, res: Response) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new HttpError(404, 'Video not found');

  await prisma.video.delete({ where: { id: video.id } });
  await removeStoredFile(video.filename, VIDEOS_DIR);
  if (video.posterFilename) await removeStoredFile(video.posterFilename, POSTERS_DIR);
  audit(req, 'video.delete', 'video', video.id, video.title);
  res.status(204).send();
});

// GET /api/admin/videos/:id/comments
router.get('/:id/comments', requirePermission('comments.view'), async (req: AuthedRequest, res: Response) => {
  const comments = await prisma.comment.findMany({ where: { videoId: req.params.id }, orderBy: { createdAt: 'desc' } });
  res.json({ comments });
});

export default router;
