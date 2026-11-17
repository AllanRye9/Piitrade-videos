import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { resolveAssetUrl } from './videos';
import { SITE_NAME, absoluteUrl, staticPageMeta, buildRobots, buildSitemap, injectHead, notFoundMeta, resolveOrigin, videoMeta, SitemapVideo } from '../lib/seo';

/**
 * Crawler-facing routes, served at the site root (not under /api) because that
 * is where crawlers look: /robots.txt, /sitemap.xml and the shared-video
 * permalink /v/:id. The reverse proxy (nginx.conf / vercel.json) forwards
 * exactly those paths here; everything else is the static SPA.
 *
 *   SITE_URL       public origin of the site, e.g. https://videos.piitrade.com
 *                  (falls back to the request's own host)
 *   SPA_SHELL_URL  where to fetch the built index.html from
 *                  (default: `${SITE_URL}/index.html`, or http://frontend/index.html)
 */
const router = Router();

const SITEMAP_MAX_VIDEOS = 5000;
const SITEMAP_TTL_MS = 10 * 60 * 1000;
const SHELL_TTL_MS = 5 * 60 * 1000;
const STATIC_PATHS = ['/', '/legal/terms', '/legal/privacy', '/legal/dmca'];

function originOf(req: Request): string {
  return resolveOrigin(process.env.SITE_URL, req.header('x-forwarded-proto'), req.header('x-forwarded-host') || req.header('host'));
}

// ── SPA shell (index.html), cached so a viral link doesn't hammer the frontend ──
let shell: { html: string; at: number } | null = null;

async function getShell(origin: string): Promise<string | null> {
  if (shell && Date.now() - shell.at < SHELL_TTL_MS) return shell.html;
  const url = process.env.SPA_SHELL_URL || (process.env.SITE_URL ? `${origin}/index.html` : 'http://frontend/index.html');
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'text/html' } });
    clearTimeout(t);
    const html = await r.text();
    if (r.ok && /<div id="root"/i.test(html)) {
      shell = { html, at: Date.now() };
      return html;
    }
  } catch (err) {
    console.error('SEO: could not fetch SPA shell from', url, (err as Error).message);
  }
  return shell?.html ?? null; // stale beats nothing
}

// ── robots.txt ──
router.get('/robots.txt', (req: Request, res: Response) => {
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(buildRobots(originOf(req)));
});

// ── sitemap.xml ──
let sitemapCache: { xml: string; origin: string; at: number } | null = null;

router.get('/sitemap.xml', async (req: Request, res: Response) => {
  const origin = originOf(req);
  if (sitemapCache && sitemapCache.origin === origin && Date.now() - sitemapCache.at < SITEMAP_TTL_MS) {
    res.type('application/xml').set('Cache-Control', 'public, max-age=600').send(sitemapCache.xml);
    return;
  }
  // Videos that have been reported are left out until a moderator has dismissed the reports.
  const rows: Array<{ id: string; title: string; description: string; filename: string; posterFilename: string | null; duration: number | null; createdAt: Date; views: number }> =
    await prisma.video.findMany({
      where: { reportList: { none: {} } },
      orderBy: { createdAt: 'desc' },
      take: SITEMAP_MAX_VIDEOS,
      select: { id: true, title: true, description: true, filename: true, posterFilename: true, duration: true, createdAt: true, views: true },
    });
  const videos: SitemapVideo[] = rows.map((v) => ({
    id: v.id,
    title: v.title,
    description: v.description,
    contentUrl: absoluteUrl(origin, resolveAssetUrl(v.filename, 'videos')),
    thumbnailUrl: v.posterFilename ? absoluteUrl(origin, resolveAssetUrl(v.posterFilename, 'posters')) : null,
    duration: v.duration,
    createdAt: v.createdAt,
    views: v.views,
  }));
  const xml = buildSitemap(origin, STATIC_PATHS, videos);
  sitemapCache = { xml, origin, at: Date.now() };
  res.type('application/xml').set('Cache-Control', 'public, max-age=600').send(xml);
});

// ── /v/:id — the shared-video page, with real meta tags for crawlers and link previews ──
router.get('/v/:id', async (req: Request, res: Response) => {
  const origin = originOf(req);
  // This is the SPA page itself, which plays media from R2 / other origins; helmet's default CSP (default-src 'self') would block that.
  res.removeHeader('Content-Security-Policy');
  const html = await getShell(origin);
  if (!html) {
    // Can't build the page here: let the proxy fall back to the plain SPA (nginx error_page) or fail visibly.
    res.status(502).type('text/plain').send(`${SITE_NAME}: page temporarily unavailable`);
    return;
  }

  const video = await prisma.video.findUnique({ where: { id: req.params.id }, include: { reportList: { select: { id: true }, take: 1 } } });
  if (!video) {
    res.status(404).type('html').set('Cache-Control', 'no-store').send(injectHead(html, notFoundMeta(origin)));
    return;
  }

  const profile = video.uploaderSessionId
    ? await prisma.sessionProfile.findUnique({ where: { sessionId: video.uploaderSessionId }, select: { handle: true, displayName: true, avatar: true } })
    : null;
  const creator = profile?.handle ? { name: profile.displayName || `@${profile.handle}`, url: `${origin}/u/${encodeURIComponent(profile.handle)}` } : null;

  const meta = videoMeta(
    origin,
    {
      id: video.id,
      title: video.title,
      description: video.description,
      contentUrl: absoluteUrl(origin, resolveAssetUrl(video.filename, 'videos')),
      thumbnailUrl: video.posterFilename ? absoluteUrl(origin, resolveAssetUrl(video.posterFilename, 'posters')) : null,
      duration: video.duration,
      createdAt: video.createdAt,
      hashtags: video.hashtags,
      likes: video.likes,
      views: video.views,
      comments: video.comments,
      creator,
    },
    { noindex: video.reportList.length > 0 }
  );
  res.type('html').set('Cache-Control', 'public, max-age=300').send(injectHead(html, meta));
});

// ── Home and legal pages: same shell, with absolute canonical / Open Graph URLs filled in ──
async function sendStaticPage(req: Request, res: Response, pathname: string) {
  const origin = originOf(req);
  const meta = staticPageMeta(origin, pathname);
  const html = await getShell(origin);
  if (!meta || !html) {
    res.status(html ? 404 : 502).type('text/plain').send(`${SITE_NAME}: page unavailable`);
    return;
  }
  res.removeHeader('Content-Security-Policy');
  res.type('html').set('Cache-Control', 'public, max-age=300').send(injectHead(html, meta));
}
router.get('/', (req, res) => sendStaticPage(req, res, '/'));
router.get('/legal/:page', (req, res) => sendStaticPage(req, res, `/legal/${req.params.page}`));

export default router;
