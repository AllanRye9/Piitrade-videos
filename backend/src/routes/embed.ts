import { Router, Request, Response } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { prisma } from '../db';
import { resolveAssetUrl } from './videos';
import { SITE_NAME, absoluteUrl, escapeHtml, resolveOrigin, truncate } from '../lib/seo';
import { listSites } from '../lib/sites';
import { loadProductsFor } from '../lib/videoProducts';
import { productUrlVariants, normalizeProductUrl, SiteValidationError } from '../lib/siteUrls';
import { oembedSize, parseVideoUrl } from '../lib/embed';

/**
 * Distribution: the embeddable player (/embed/:id), oEmbed discovery
 * (/api/oembed), the by-product lookup the shop widget uses
 * (/api/public/videos), and the two small scripts shops add to their pages
 * (/widget.js, /track.js). Mounted before the global CORS/CSP setup: these
 * are meant to be used from other people's sites.
 *
 *   SITE_URL                public origin (falls back to the request host)
 *   EMBED_FRAME_ANCESTORS   who may frame the player, space-separated origins (default: any)
 */
const router = Router();
const open = cors({ origin: '*', methods: ['GET', 'HEAD'], maxAge: 86400 });

function originOf(req: Request): string {
  return resolveOrigin(process.env.SITE_URL, req.header('x-forwarded-proto'), req.header('x-forwarded-host') || req.header('host'));
}

async function loadPublicVideo(id: string) {
  const video = await prisma.video.findUnique({ where: { id }, include: { reportList: { select: { id: true }, take: 1 } } });
  if (!video || video.reportList.length > 0) return null; // reported videos aren't distributed until a moderator clears them
  const profile = video.uploaderSessionId
    ? await prisma.sessionProfile.findUnique({ where: { sessionId: video.uploaderSessionId }, select: { handle: true, displayName: true } })
    : null;
  return { video, creator: profile?.handle ? { name: profile.displayName || `@${profile.handle}`, handle: profile.handle as string } : null };
}

// ── /embed/:id ──────────────────────────────────────────────────────────────
router.get('/embed/:id', async (req: Request, res: Response) => {
  const origin = originOf(req);
  const nonce = crypto.randomBytes(16).toString('base64');
  const ancestors = (process.env.EMBED_FRAME_ANCESTORS || '*').trim() || '*';
  // This page is meant to be framed anywhere: lift helmet's same-origin framing rules and use a tight policy of its own.
  res.removeHeader('X-Frame-Options');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; img-src * data:; media-src * blob:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors ${ancestors}`
  );
  res.set('Cache-Control', 'public, max-age=300').set('Referrer-Policy', 'origin-when-cross-origin');

  const found = await loadPublicVideo(req.params.id);
  if (!found) {
    res.status(404).type('html').set('Cache-Control', 'no-store').send(page(nonce, 'Video unavailable', `<div class="gone">This video is unavailable.</div>`, ''));
    return;
  }
  const { video, creator } = found;
  const sites = await listSites();
  const productRows = (await loadProductsFor([video.id])).get(video.id) ?? [];
  const products = productRows
    .map((p) => {
      const s = sites.find((x) => x.id === p.siteId && x.active);
      return s ? { href: `${origin}/go/${video.id}/${p.id}`, label: p.title || `Shop on ${s.name}`, start: p.startMs, end: p.endMs } : null;
    })
    .filter((p): p is { href: string; label: string; start: number; end: number | null } => !!p);

  const src = absoluteUrl(origin, resolveAssetUrl(video.filename, 'videos'));
  const poster = video.posterFilename ? absoluteUrl(origin, resolveAssetUrl(video.posterFilename, 'posters')) : '';
  const autoplay = req.query.autoplay !== '0';
  const permalink = `${origin}/v/${encodeURIComponent(video.id)}`;

  const body = `
<video id="v" src="${escapeHtml(src)}" ${poster ? `poster="${escapeHtml(poster)}"` : ''} controls playsinline preload="metadata" ${autoplay ? 'autoplay muted loop' : ''}></video>
<div class="top"><a href="${escapeHtml(permalink)}" target="_blank" rel="noopener">${escapeHtml(truncate(video.title || 'Untitled video', 70))}${creator ? ` · @${escapeHtml(creator.handle)}` : ''}</a></div>
<div class="chips" id="chips">${products
    .map(
      (p) =>
        `<a class="chip" href="${escapeHtml(p.href)}" target="_blank" rel="noopener sponsored" data-s="${p.start}" data-e="${p.end ?? ''}">🛍 ${escapeHtml(truncate(p.label, 40))}</a>`
    )
    .join('')}</div>
<a class="brand" href="${escapeHtml(permalink)}" target="_blank" rel="noopener">${escapeHtml(SITE_NAME)}</a>`;

  const script = `
var v=document.getElementById('v'),chips=[].slice.call(document.querySelectorAll('.chip'));
function sync(){var t=v.currentTime*1000;chips.forEach(function(c){var s=+c.dataset.s,e=c.dataset.e===''?Infinity:+c.dataset.e;c.style.display=(t>=s&&t<e)?'':'none'})}
v.addEventListener('timeupdate',sync);v.addEventListener('seeked',sync);sync();
var counted=false;
v.addEventListener('playing',function(){if(counted)return;setTimeout(function(){if(counted||v.paused)return;counted=true;
try{var k='pv_embed_sid',id=localStorage.getItem(k);if(!id){id='emb-'+Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem(k,id)}
fetch('/api/videos/${video.id}/view',{method:'POST',headers:{'X-Session-Id':id}}).catch(function(){})}catch(e){}},3000)});`;

  res.type('html').send(page(nonce, video.title || SITE_NAME, body, script));
});

function page(nonce: string, title: string, body: string, script: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style nonce="${nonce}">
html,body{margin:0;height:100%;background:#000;color:#fff;font:14px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden}
#v{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
.top{position:absolute;top:0;left:0;right:0;padding:10px 12px;background:linear-gradient(#0009,#0000);pointer-events:none}
.top a{color:#fff;text-decoration:none;font-weight:600;pointer-events:auto}
.chips{position:absolute;left:10px;right:10px;bottom:56px;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.chip{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#fff;color:#111;border-radius:999px;padding:8px 14px;font-weight:700;text-decoration:none;box-shadow:0 2px 8px #0006}
.brand{position:absolute;right:10px;top:10px;color:#fffc;font-size:11px;text-decoration:none;pointer-events:auto}
.gone{display:flex;height:100%;align-items:center;justify-content:center;color:#aaa}
</style></head><body>${body}<script nonce="${nonce}">${script}</script></body></html>`;
}

// ── /api/oembed ─────────────────────────────────────────────────────────────
router.get('/api/oembed', open, async (req: Request, res: Response) => {
  if (String(req.query.format || 'json').toLowerCase() !== 'json') {
    res.status(501).json({ error: 'Only format=json is supported' });
    return;
  }
  const origin = originOf(req);
  const id = parseVideoUrl(String(req.query.url || ''), [origin, process.env.SITE_URL || '']);
  if (!id) {
    res.status(404).json({ error: 'Not a video link on this site' });
    return;
  }
  const found = await loadPublicVideo(id);
  if (!found) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  const { video, creator } = found;
  const { width, height } = oembedSize(Number(req.query.maxwidth) || undefined, Number(req.query.maxheight) || undefined);
  const embed = `${origin}/embed/${encodeURIComponent(video.id)}`;
  res.set('Cache-Control', 'public, max-age=300').json({
    version: '1.0',
    type: 'video',
    provider_name: SITE_NAME,
    provider_url: origin,
    title: video.title || 'Untitled video',
    ...(creator ? { author_name: creator.name, author_url: `${origin}/u/${encodeURIComponent(creator.handle)}` } : {}),
    ...(video.posterFilename ? { thumbnail_url: absoluteUrl(origin, resolveAssetUrl(video.posterFilename, 'posters')) } : {}),
    html: `<iframe src="${escapeHtml(embed)}" width="${width}" height="${height}" style="border:0;max-width:100%" allow="autoplay; fullscreen" allowfullscreen loading="lazy" title="${escapeHtml(video.title || SITE_NAME)}"></iframe>`,
    width,
    height,
  });
});

// ── /api/public/videos?product=<url>&limit=6 — the videos that feature a product page ─
router.get('/api/public/videos', open, async (req: Request, res: Response) => {
  let variants: string[];
  try {
    variants = productUrlVariants(normalizeProductUrl(req.query.product));
  } catch (err) {
    if (err instanceof SiteValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  const limit = Math.max(1, Math.min(12, Math.trunc(Number(req.query.limit)) || 6));
  const origin = originOf(req);
  const rows: Array<{ id: string; title: string; posterFilename: string | null; duration: number | null; views: number }> = await prisma.video.findMany({
    where: { products: { some: { url: { in: variants } } }, reportList: { none: {} } },
    orderBy: [{ views: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    select: { id: true, title: true, posterFilename: true, duration: true, views: true },
  });
  res.set('Cache-Control', 'public, max-age=120').json({
    videos: rows.map((v) => ({
      id: v.id,
      title: v.title,
      poster: v.posterFilename ? absoluteUrl(origin, resolveAssetUrl(v.posterFilename, 'posters')) : null,
      duration: v.duration,
      views: v.views,
      permalink: `${origin}/v/${encodeURIComponent(v.id)}`,
      embedUrl: `${origin}/embed/${encodeURIComponent(v.id)}`,
    })),
  });
});

// ── /widget.js — drop-in carousel for a shop's product page ──────────────────
//   <div data-piitrade-videos data-product-url="https://shop.example/listings/123"></div>
//   <script async src="https://videos.example/widget.js"></script>
router.get('/widget.js', open, (req: Request, res: Response) => {
  const base = JSON.stringify(originOf(req));
  res.type('application/javascript').set('Cache-Control', 'public, max-age=3600').send(`(function(){
var BASE=${base};
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function mount(el){
  if(el.__pv)return;el.__pv=1;
  var url=el.getAttribute('data-product-url')||location.href.split('#')[0];
  var limit=el.getAttribute('data-limit')||'6';
  var heading=el.getAttribute('data-heading');if(heading===null)heading='Videos featuring this item';
  fetch(BASE+'/api/public/videos?limit='+encodeURIComponent(limit)+'&product='+encodeURIComponent(url))
    .then(function(r){return r.ok?r.json():{videos:[]}})
    .then(function(d){
      if(!d.videos||!d.videos.length)return;
      var h=(heading?'<div style="font:600 15px system-ui,sans-serif;margin:0 0 8px">'+esc(heading)+'</div>':'');
      el.innerHTML=h+'<div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:6px">'+d.videos.map(function(v){
        return '<iframe src="'+esc(v.embedUrl)+'?autoplay=0" title="'+esc(v.title)+'" loading="lazy" allow="autoplay; fullscreen" allowfullscreen style="flex:0 0 180px;width:180px;height:320px;border:0;border-radius:12px;background:#000"></iframe>';
      }).join('')+'</div>';
    }).catch(function(){});
}
function run(){[].forEach.call(document.querySelectorAll('[data-piitrade-videos]'),mount)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();`);
});

// ── /track.js — shop-side: remember which video sent the visitor ─────────────
// Saves ?pv_click=<token> (added by our /go links) into a first-party cookie for 30 days. At checkout the shop's
// server reads that cookie and reports the sale (see docs/OPEN_SHOP_SPEC.md). window.PiitradeVideos.click() returns it.
router.get('/track.js', open, (_req: Request, res: Response) => {
  res.type('application/javascript').set('Cache-Control', 'public, max-age=3600').send(`(function(){
var K='pv_click',DAYS=30;
function read(){var m=document.cookie.match(/(?:^|; )pv_click=([^;]+)/);if(m)return decodeURIComponent(m[1]);try{return localStorage.getItem(K)}catch(e){return null}}
try{var t=new URLSearchParams(location.search).get(K);
if(t&&/^[A-Za-z0-9_-]{8,64}$/.test(t)){document.cookie=K+'='+encodeURIComponent(t)+'; max-age='+(DAYS*86400)+'; path=/; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');try{localStorage.setItem(K,t)}catch(e){}}}catch(e){}
window.PiitradeVideos={click:read};
})();`);
});

export default router;
