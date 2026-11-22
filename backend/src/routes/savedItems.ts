import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { HttpError } from '../lib/httpError';
import { writeLimiter } from '../middleware/rateLimit';
import { getSessionId, resolveAssetUrl } from './videos';

/**
 * Saved items. Tapping a product tag in a video saves it instead of opening a browser, so the viewer
 * keeps watching and decides later. Works for guests too (their anonymous session id keeps the list);
 * it is deliberately not gated behind sign-in, since an auth prompt is exactly the interruption this
 * feature exists to avoid.
 */
const router = Router();
export const MAX_SAVED_ITEMS = 200;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function needSession(req: Request): string {
  const id = getSessionId(req);
  if (id === 'anonymous') throw new HttpError(400, 'Missing session');
  return id;
}

// GET /api/saved-items — newest first
router.get('/', async (req: Request, res: Response) => {
  const sessionId = needSession(req);
  const rows: any[] = await prisma.savedItem.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: MAX_SAVED_ITEMS,
    include: { site: { select: { name: true, active: true } }, video: { select: { id: true, title: true, posterFilename: true } } },
  });
  res.json({
    items: rows
      .filter((r) => r.site?.active !== false) // a disabled shop's items are hidden, not deleted
      .map((r) => ({
        id: r.id,
        title: r.title || hostOf(r.url),
        url: r.url,
        host: hostOf(r.url),
        site: r.site?.name ?? '',
        videoId: r.video?.id ?? null,
        videoTitle: r.video?.title ?? null,
        poster: r.video?.posterFilename ? resolveAssetUrl(r.video.posterFilename, 'posters') : null,
        createdAt: r.createdAt,
      })),
  });
});

// POST /api/saved-items  { videoId, productId } — idempotent: saving the same product again returns the same item.
router.post('/', writeLimiter, async (req: Request, res: Response) => {
  const sessionId = needSession(req);
  const videoId = String(req.body?.videoId || '');
  const productId = String(req.body?.productId || '');
  if (!videoId || !productId) throw new HttpError(400, 'videoId and productId are required');

  const product = await prisma.videoProduct.findFirst({ where: { id: productId, videoId }, include: { site: true } });
  if (!product || !product.site.active) throw new HttpError(404, 'Product not found');

  const existing = await prisma.savedItem.findUnique({ where: { sessionId_urlKey: { sessionId, urlKey: product.urlKey } } });
  if (existing) {
    res.json({ saved: true, id: existing.id, count: await prisma.savedItem.count({ where: { sessionId } }) });
    return;
  }
  if ((await prisma.savedItem.count({ where: { sessionId } })) >= MAX_SAVED_ITEMS) {
    throw new HttpError(409, `Your saved list is full (${MAX_SAVED_ITEMS} items). Remove something to save more.`, { code: 'SAVED_FULL' });
  }

  let id: string;
  try {
    const item = await prisma.savedItem.create({
      data: { sessionId, videoId, siteId: product.siteId, url: product.url, urlKey: product.urlKey, title: product.title || hostOf(product.url) },
    });
    id = item.id;
  } catch (err: any) {
    // Two taps at once: the other one won. Same end state.
    if (err?.code !== 'P2002') throw err;
    const again = await prisma.savedItem.findUnique({ where: { sessionId_urlKey: { sessionId, urlKey: product.urlKey } } });
    id = again?.id ?? '';
  }
  res.status(201).json({ saved: true, id, count: await prisma.savedItem.count({ where: { sessionId } }) });
});

// DELETE /api/saved-items/:id — only your own; removing something already gone is fine.
router.delete('/:id', writeLimiter, async (req: Request, res: Response) => {
  const sessionId = needSession(req);
  await prisma.savedItem.deleteMany({ where: { id: req.params.id, sessionId } });
  res.status(204).send();
});

export default router;
