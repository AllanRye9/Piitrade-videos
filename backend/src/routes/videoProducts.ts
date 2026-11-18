import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { prisma } from '../db';
import { HttpError } from '../lib/httpError';
import { requireAccount } from '../middleware/requireAccount';
import { writeLimiter } from '../middleware/rateLimit';
import { getSessionId } from './videos';
import { loadProductsFor, replaceProducts, resolveProductPlan, MAX_PRODUCTS_PER_VIDEO } from '../lib/videoProducts';
import { extractFrame, sampleTimes } from '../lib/frames';
import { identifyImage } from '../lib/aiSearch';
import { searchSites } from '../lib/marketplace';
import { hasSearchableSites } from '../lib/sites';
import { VIDEOS_DIR } from '../paths';
import { stripTrackingParams } from '../lib/siteUrls';

/**
 * Owner-side editing of a video's pinned products ("shoppable moments").
 *   GET  /api/videos/:id/products          — current list
 *   PUT  /api/videos/:id/products          — replace the list  { products: [...] }
 *   POST /api/videos/:id/suggest-products  — AI: look at a few frames, propose matching listings
 */
const router = Router();

// The suggestion call runs ffmpeg and several AI/search requests, so it is tightly limited per session.
const suggestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.header('x-session-id')?.trim() || req.ip || 'unknown',
  message: { error: 'Too many suggestion requests — try again later.' },
});

async function ownVideo(req: Request) {
  const sessionId = getSessionId(req);
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new HttpError(404, 'Video not found');
  if (!video.uploaderSessionId || video.uploaderSessionId !== sessionId) throw new HttpError(403, 'You can only edit your own videos');
  return video as { id: string; filename: string; duration: number | null; siteId: string | null; productUrl: string | null; productTitle: string | null };
}

const shape = (r: any) => ({ id: r.id, siteId: r.siteId, url: r.url, title: r.title, startMs: r.startMs, endMs: r.endMs, x: r.x, y: r.y });

router.get('/:id/products', requireAccount, async (req: Request, res: Response) => {
  const video = await ownVideo(req);
  const map = await loadProductsFor([video.id]);
  res.json({ products: (map.get(video.id) ?? []).map(shape), max: MAX_PRODUCTS_PER_VIDEO });
});

router.put('/:id/products', requireAccount, writeLimiter, async (req: Request, res: Response) => {
  const video = await ownVideo(req);
  if (req.body?.products === undefined) throw new HttpError(400, 'products is required');
  const plan = await resolveProductPlan({ products: req.body.products }, video, video.duration ? video.duration * 1000 : null);
  await replaceProducts(video.id, plan!);
  const map = await loadProductsFor([video.id]);
  res.json({ products: (map.get(video.id) ?? []).map(shape) });
});


router.post('/:id/suggest-products', requireAccount, suggestLimiter, async (req: Request, res: Response) => {
  const video = await ownVideo(req);
  if (!process.env.AI_SEARCH || !(await hasSearchableSites())) {
    throw new HttpError(503, 'Suggestions need the AI service (AI_SEARCH) and at least one shop with a search API.');
  }
  const duration = video.duration ?? 0;
  const times = sampleTimes(duration);
  if (times.length === 0) throw new HttpError(422, 'This video has no readable length');
  const input = /^https?:\/\//i.test(video.filename) ? video.filename : path.join(VIDEOS_DIR, video.filename);
  const windowMs = Math.round((duration * 1000) / times.length);

  // Frames are looked at one after another: it bounds AI cost and keeps ffmpeg to one process.
  type Suggestion = { query: string; startMs: number; endMs: number; candidates: Array<{ title: string; url: string; image: string; price: string; site: string | null }> };
  const suggestions: Suggestion[] = [];
  for (const t of times) {
    try {
      const frame = await extractFrame(input, t);
      const ident = await identifyImage(frame, 'image/jpeg');
      const key = ident.text.trim().toLowerCase();
      const startMs = Math.max(0, Math.round(t * 1000) - Math.round(windowMs / 2));
      const endMs = Math.min(Math.round(duration * 1000), startMs + windowMs);
      const prev = suggestions.find((s) => s.query.trim().toLowerCase() === key);
      if (prev) {
        prev.endMs = Math.max(prev.endMs, endMs); // same thing seen again: widen its window
        continue;
      }
      const found = await searchSites(ident.text).catch(() => null);
      const candidates = (found?.results ?? []).slice(0, 3).map((p) => ({ title: p.name, url: stripTrackingParams(p.listingUrl), image: p.image, price: p.price, site: p.site?.slug ?? null }));
      if (candidates.length) suggestions.push({ query: ident.text, startMs, endMs, candidates });
    } catch (err) {
      console.error('[suggest-products] frame skipped:', err instanceof Error ? err.message : err);
    }
  }
  res.json({ suggestions });
});

export default router;
