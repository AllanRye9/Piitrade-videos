/**
 * Server-rendered public pages for a video: the embeddable player (/embed/:id),
 * the shareable permalink with SEO metadata (/v/:id) and the oEmbed response.
 * No sign-in, no cookies, no third-party scripts.
 */
export interface PageVideo {
  id: string;
  title: string;
  description: string;
  fileUrl: string;
  posterUrl: string | null;
  duration: number | null;
  createdAt: Date;
  uploaderHandle: string | null;
  views: number;
  likes: number;
}

export interface PageProduct {
  id: string;
  title: string;
  host: string;
  startMs: number;
  endMs: number | null;
}

export interface PageCtx {
  /** Public origin of this deployment, e.g. https://videos.example.com (no trailing slash). */
  origin: string;
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** JSON that is safe to place inside a <script> element. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export const embedUrl = (c: PageCtx, id: string) => `${c.origin}/embed/${encodeURIComponent(id)}`;
export const permalinkUrl = (c: PageCtx, id: string) => `${c.origin}/v/${encodeURIComponent(id)}`;

/** Extracts the video id from a /v/:id or /embed/:id URL on this deployment (used by oEmbed). */
export function videoIdFromUrl(raw: string, c: PageCtx): string | null {
  try {
    const u = new URL(raw);
    if (u.origin !== new URL(c.origin).origin) return null;
    const m = u.pathname.match(/^\/(?:v|embed)\/([^/]+)\/?$/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

export function iframeHtml(v: PageVideo, c: PageCtx, width = 360, height = 640): string {
  return `<iframe src="${esc(embedUrl(c, v.id))}" width="${width}" height="${height}" style="border:0;max-width:100%" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy" title="${esc(v.title || 'Piitrade video')}"></iframe>`;
}

export function oembedJson(v: PageVideo, c: PageCtx, maxWidth?: number, maxHeight?: number) {
  // Portrait 9:16 by default, scaled down to fit whatever box the consumer allows.
  let width = 360;
  let height = 640;
  if (maxWidth && maxWidth > 0 && width > maxWidth) {
    height = Math.round((height * maxWidth) / width);
    width = maxWidth;
  }
  if (maxHeight && maxHeight > 0 && height > maxHeight) {
    width = Math.round((width * maxHeight) / height);
    height = maxHeight;
  }
  return {
    version: '1.0',
    type: 'video',
    provider_name: 'Piitrade Videos',
    provider_url: c.origin,
    title: v.title || 'Piitrade video',
    author_name: v.uploaderHandle ? `@${v.uploaderHandle}` : undefined,
    author_url: v.uploaderHandle ? `${c.origin}/u/${encodeURIComponent(v.uploaderHandle)}` : undefined,
    thumbnail_url: v.posterUrl ?? undefined,
    html: iframeHtml(v, c, width, height),
    width,
    height,
  };
}

const BASE_CSS = `
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#000;color:#fff;font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:inherit;text-decoration:none}
.stage{position:relative;width:100%;height:100%;background:#000;overflow:hidden}
video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
.shade{position:absolute;left:0;right:0;bottom:0;height:38%;background:linear-gradient(to top,rgba(0,0,0,.7),transparent);pointer-events:none}
.meta{position:absolute;left:12px;right:12px;bottom:12px;display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.title{font-weight:700;font-size:15px;text-shadow:0 1px 4px rgba(0,0,0,.6);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-flex;align-items:center;gap:6px;background:#ff6a00;color:#fff;border-radius:999px;padding:7px 13px;font-weight:700;font-size:13px;max-width:100%}
.chip small{font-weight:500;opacity:.85}
.chip[hidden]{display:none}
.brand{position:absolute;top:10px;left:10px;font-size:12px;font-weight:700;background:rgba(0,0,0,.45);padding:5px 10px;border-radius:999px}
`;

function chipHtml(p: PageProduct, videoId: string, c: PageCtx): string {
  const href = `${c.origin}/go/${encodeURIComponent(videoId)}/${encodeURIComponent(p.id)}`;
  return `<a class="chip" data-start="${p.startMs}" data-end="${p.endMs ?? ''}" href="${esc(href)}" target="_blank" rel="noopener sponsored">🛍 ${esc(p.title || 'Shop this item')} <small>${esc(p.host)}</small></a>`;
}

/** Shows each chip only inside its [start, end) window (chips with no window are always shown). */
const CHIP_SCRIPT = `(function(){var v=document.querySelector('video'),cs=[].slice.call(document.querySelectorAll('.chip[data-start]'));
function s(){var t=v.currentTime*1000;cs.forEach(function(c){var a=+c.dataset.start,b=c.dataset.end===''?Infinity:+c.dataset.end;c.hidden=!(t>=a&&t<b)})}
if(v){v.addEventListener('timeupdate',s);s()}})();`;

export function embedPageHtml(v: PageVideo, products: PageProduct[], c: PageCtx): string {
  const chips = products.map((p) => chipHtml(p, v.id, c)).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(v.title || 'Piitrade video')}</title><style>${BASE_CSS}</style></head><body>
<div class="stage">
<video src="${esc(v.fileUrl)}" ${v.posterUrl ? `poster="${esc(v.posterUrl)}"` : ''} muted autoplay loop playsinline controls preload="metadata"></video>
<a class="brand" href="${esc(permalinkUrl(c, v.id))}" target="_blank" rel="noopener">Piitrade Videos</a>
<div class="shade"></div>
<div class="meta">${v.title ? `<div class="title">${esc(v.title)}</div>` : ''}<div class="chips">${chips}</div></div>
</div>
<script>${CHIP_SCRIPT}</script></body></html>`;
}

export function jsonLdVideo(v: PageVideo, products: PageProduct[], c: PageCtx) {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: v.title || 'Piitrade video',
    description: v.description || v.title || 'Short video on Piitrade Videos',
    thumbnailUrl: v.posterUrl ? [v.posterUrl] : undefined,
    uploadDate: v.createdAt.toISOString(),
    contentUrl: v.fileUrl,
    embedUrl: embedUrl(c, v.id),
    url: permalinkUrl(c, v.id),
    duration: v.duration ? `PT${Math.round(v.duration)}S` : undefined,
    interactionStatistic: [
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/WatchAction', userInteractionCount: v.views },
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: v.likes },
    ],
    // The products pinned in the video, so search engines can show them.
    about: products.length ? products.map((p) => ({ '@type': 'Product', name: p.title || p.host, url: `${c.origin}/go/${encodeURIComponent(v.id)}/${encodeURIComponent(p.id)}` })) : undefined,
  };
}

export function permalinkPageHtml(v: PageVideo, products: PageProduct[], c: PageCtx): string {
  const title = v.title || 'Video on Piitrade Videos';
  const desc = (v.description || `Watch ${title}${v.uploaderHandle ? ` by @${v.uploaderHandle}` : ''} on Piitrade Videos`).slice(0, 200);
  const chips = products.map((p) => chipHtml(p, v.id, c)).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Piitrade Videos</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(permalinkUrl(c, v.id))}">
<meta property="og:type" content="video.other"><meta property="og:site_name" content="Piitrade Videos">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(permalinkUrl(c, v.id))}">
${v.posterUrl ? `<meta property="og:image" content="${esc(v.posterUrl)}">` : ''}
<meta property="og:video" content="${esc(v.fileUrl)}"><meta property="og:video:type" content="video/mp4">
<meta name="twitter:card" content="player"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:player" content="${esc(embedUrl(c, v.id))}"><meta name="twitter:player:width" content="360"><meta name="twitter:player:height" content="640">
<link rel="alternate" type="application/json+oembed" href="${esc(`${c.origin}/api/oembed?url=${encodeURIComponent(permalinkUrl(c, v.id))}&format=json`)}" title="${esc(title)}">
<script type="application/ld+json">${safeJson(jsonLdVideo(v, products, c))}</script>
<style>${BASE_CSS}.page{max-width:430px;height:100dvh;margin:0 auto;position:relative}.open{position:absolute;top:10px;right:10px;background:#fff;color:#000;border-radius:999px;padding:6px 12px;font-weight:700;font-size:12px;z-index:2}</style></head><body>
<div class="page"><div class="stage">
<video src="${esc(v.fileUrl)}" ${v.posterUrl ? `poster="${esc(v.posterUrl)}"` : ''} muted autoplay loop playsinline controls preload="metadata"></video>
<a class="open" href="piitrade://v/${encodeURIComponent(v.id)}">Open in app</a>
<div class="shade"></div>
<div class="meta">${v.uploaderHandle ? `<a class="title" href="${esc(`${c.origin}/u/${encodeURIComponent(v.uploaderHandle)}`)}">@${esc(v.uploaderHandle)}</a>` : ''}${v.title ? `<div class="title">${esc(v.title)}</div>` : ''}<div class="chips">${chips}</div></div>
</div></div>
<script>${CHIP_SCRIPT}</script></body></html>`;
}

/** The one-tag script shops add to product pages. It finds the videos pinned to that page's product and shows them. */
export function widgetScript(c: PageCtx): string {
  const origin = safeJson(c.origin);
  return `(function(){
var O=${origin};
function mount(el){
  var url=el.getAttribute('data-product-url')||(document.querySelector('link[rel=canonical]')||{}).href||location.href;
  var max=+el.getAttribute('data-limit')||3;
  fetch(O+'/api/embed/by-product?url='+encodeURIComponent(url)+'&limit='+max).then(function(r){return r.ok?r.json():{videos:[]}}).then(function(d){
    if(!d.videos||!d.videos.length){el.style.display='none';return}
    el.style.cssText='display:flex;gap:12px;overflow-x:auto;padding:4px 0';
    d.videos.forEach(function(v){var f=document.createElement('iframe');f.src=O+'/embed/'+encodeURIComponent(v.id);f.width=220;f.height=390;f.loading='lazy';f.title=v.title||'Video';f.style.cssText='border:0;border-radius:12px;flex:0 0 auto;max-width:100%';f.allow='autoplay; encrypted-media';el.appendChild(f)});
  }).catch(function(){el.style.display='none'});
}
function run(){[].forEach.call(document.querySelectorAll('[data-piitrade-videos]'),function(el){if(!el.__pv){el.__pv=1;mount(el)}})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();`;
}
