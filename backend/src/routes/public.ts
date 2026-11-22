import { Router, Request, Response } from 'express';
import cors from 'cors';
import { prisma } from '../db';
import { HttpError } from '../lib/httpError';
import { normalizeProductUrl } from '../lib/attribution';
import { resolveFrameAncestors, ShopEmbedRule } from '../lib/embedOrigins';
import { embedPageHtml, oembedJson, permalinkPageHtml, videoIdFromUrl, widgetScript, PageCtx, PageProduct, PageVideo } from '../lib/embedPages';
import { resolveAssetUrl } from './videos';
import { redirectLimiter } from '../middleware/rateLimit';

/**
 * Public, sign-in-free surfaces that make videos usable outside the app:
 *   /embed/:id          embeddable player (iframe-able)
 *   /v/:id              shareable permalink with SEO metadata + oEmbed discovery
 *   /api/oembed         standard oEmbed JSON
 *   /embed.js           one-tag widget for shop product pages
 *   /api/embed/by-product  videos pinned to a product URL (used by the widget)
 *
 * None of these set cookies or load third-party scripts.
 */
const router = Router();
const openCors = cors({ origin: '*' }); // read-only public data; shops call these from their own domains

function ctxFor(req: Request): PageCtx {
  const configured = (process.env.PUBLIC_WEB_URL || '').replace(/\/+$/, '');
  if (configured) return { origin: configured };
  const proto = String(req.header('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  return { origin: `${proto}://${req.header('x-forwarded-host') || req.get('host')}` };
}

const absolute = (u: string, origin: string) => (/^https?:\/\//i.test(u) ? u : `${origin}${u}`);

async function loadPage(id: string, ctx: PageCtx): Promise<{ video: PageVideo; products: PageProduct[]; embedRules: ShopEmbedRule[] } | null> {
  const v: any = await prisma.video.findUnique({
    where: { id },
    include: { products: { where: { site: { active: true } }, orderBy: [{ position: 'asc' }, { startMs: 'asc' }], include: { site: { select: { baseUrl: true, embedOrigins: true } } } } },
  });
  if (!v) return null;
  const profile = v.uploaderSessionId ? await prisma.sessionProfile.findUnique({ where: { sessionId: v.uploaderSessionId }, select: { handle: true } }) : null;
  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };
  return {
    video: {
      id: v.id,
      title: v.title,
      description: v.description,
      fileUrl: absolute(resolveAssetUrl(v.filename, 'videos'), ctx.origin),
      posterUrl: v.posterFilename ? absolute(resolveAssetUrl(v.posterFilename, 'posters'), ctx.origin) : null,
      duration: v.duration ?? null,
      createdAt: v.createdAt,
      uploaderHandle: profile?.handle ?? null,
      views: v.views,
      likes: v.likes,
    },
    products: v.products.map((p: any) => ({ id: p.id, title: p.title, host: host(p.url), startMs: p.startMs, endMs: p.endMs ?? null })),
    // One rule per shop the video carries (not per product), for the embed allow-list.
    embedRules: [...new Map<string, ShopEmbedRule>(v.products.map((p: any) => [p.site.baseUrl, { baseUrl: p.site.baseUrl, embedOrigins: p.site.embedOrigins }])).values()],
  };
}

function pageHeaders(res: Response, opts: { framable: boolean; embedRules?: ShopEmbedRule[] }) {
  const ancestors = opts.framable ? resolveFrameAncestors(process.env.EMBED_FRAME_ANCESTORS, opts.embedRules ?? []) : "'self'";
  res.removeHeader('X-Frame-Options'); // helmet's default would block every third-party iframe
  res.set('Content-Security-Policy', ["default-src 'none'", 'media-src * data: blob:', 'img-src * data:', "style-src 'unsafe-inline'", "script-src 'unsafe-inline'", `frame-ancestors ${ancestors}`, "base-uri 'none'", "form-action 'none'"].join('; '));
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Cache-Control', 'public, max-age=60');
}

const notFound = (res: Response) => res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font:16px system-ui;background:#000;color:#fff;display:grid;place-items:center;height:100vh;margin:0">Video not found</body>');

router.get('/embed/:id', redirectLimiter, async (req: Request, res: Response) => {
  const ctx = ctxFor(req);
  const page = await loadPage(req.params.id, ctx);
  if (!page) return void notFound(res);
  pageHeaders(res, { framable: true, embedRules: page.embedRules });
  res.type('html').send(embedPageHtml(page.video, page.products, ctx));
});

router.get('/v/:id', redirectLimiter, async (req: Request, res: Response) => {
  const ctx = ctxFor(req);
  const page = await loadPage(req.params.id, ctx);
  if (!page) return void notFound(res);
  pageHeaders(res, { framable: false });
  res.type('html').send(permalinkPageHtml(page.video, page.products, ctx));
});

// GET /api/oembed?url=<permalink or embed URL>&maxwidth=&maxheight=&format=json
router.get('/api/oembed', openCors, redirectLimiter, async (req: Request, res: Response) => {
  if (req.query.format && req.query.format !== 'json') throw new HttpError(501, 'Only format=json is supported');
  const ctx = ctxFor(req);
  const id = videoIdFromUrl(String(req.query.url || ''), ctx);
  if (!id) throw new HttpError(404, 'Not a video URL on this site');
  const page = await loadPage(id, ctx);
  if (!page) throw new HttpError(404, 'Video not found');
  res.set('Cache-Control', 'public, max-age=300');
  res.json(oembedJson(page.video, ctx, Number(req.query.maxwidth) || undefined, Number(req.query.maxheight) || undefined));
});

router.get('/embed.js', (req: Request, res: Response) => {
  res.type('application/javascript').set('Cache-Control', 'public, max-age=300').set('Cross-Origin-Resource-Policy', 'cross-origin').send(widgetScript(ctxFor(req)));
});

// GET /api/embed/by-product?url=<product page URL>&limit=3
router.get('/api/embed/by-product', openCors, redirectLimiter, async (req: Request, res: Response) => {
  const key = normalizeProductUrl(String(req.query.url || ''));
  if (!key) throw new HttpError(400, 'A valid url is required');
  const limit = Math.min(10, Math.max(1, Number(req.query.limit) || 3));
  const rows = await prisma.videoProduct.findMany({
    where: { urlKey: key, site: { active: true } },
    select: { video: { select: { id: true, title: true, views: true } } },
    take: 50,
  });
  const unique = new Map<string, { id: string; title: string; views: number }>();
  for (const r of rows as any[]) if (r.video) unique.set(r.video.id, r.video);
  const videos = [...unique.values()].sort((a, b) => b.views - a.views).slice(0, limit).map((v) => ({ id: v.id, title: v.title }));
  res.set('Cache-Control', 'public, max-age=120');
  res.json({ videos });
});

export default router;
