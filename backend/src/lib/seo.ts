/**
 * Pure SEO helpers (no DB / network) — unit-tested in test/seo.test.js.
 *
 * The frontend is a client-rendered SPA, so crawlers and link-preview bots
 * (WhatsApp, Facebook, X, Telegram, Slack…) that don't run JavaScript only
 * ever see the static index.html. routes/seo.ts uses these helpers to serve
 * that same shell with the right <title>, description, Open Graph / Twitter
 * tags and JSON-LD already filled in for shared video links, plus a sitemap
 * and robots.txt.
 */

export const SITE_NAME = 'Yotweek';
export const DEFAULT_DESCRIPTION = 'Creative short videos that link to the products you see. Watch, then find the item on the shop.';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** XML 1.0 escaping that also drops characters XML forbids (control chars would make the whole sitemap invalid). */
export function escapeXml(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Collapses whitespace and cuts at a word boundary with an ellipsis. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:!-]+$/, '')}…`;
}

/** Seconds → ISO 8601 duration ("PT1M5S"), as schema.org and Google's video sitemap expect. */
export function isoDuration(seconds: number | null | undefined): string | undefined {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s || (!h && !m) ? `${s}S` : ''}`;
}

/** Makes a stored URL/path absolute against the public site origin. */
export function absoluteUrl(origin: string, urlOrPath: string): string {
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  return `${origin}${urlOrPath.startsWith('/') ? '' : '/'}${urlOrPath}`;
}

/** The public origin used for canonical URLs: SITE_URL if configured, else derived from the request. */
export function resolveOrigin(siteUrl: string | undefined, proto: string | undefined, host: string | undefined): string {
  if (siteUrl && /^https?:\/\//i.test(siteUrl)) return siteUrl.replace(/\/+$/, '');
  const p = (proto || 'https').split(',')[0].trim();
  return `${p === 'http' || p === 'https' ? p : 'https'}://${(host || 'localhost').split(',')[0].trim()}`;
}

export interface VideoSeoInput {
  id: string;
  title: string;
  description: string;
  /** Absolute URL of the playable file. */
  contentUrl: string;
  /** Absolute URL of the poster, if any. */
  thumbnailUrl: string | null;
  duration: number | null;
  createdAt: Date;
  hashtags: string[];
  likes: number;
  views: number;
  comments: number;
  creator?: { name: string; url: string } | null;
}

export interface PageMeta {
  /** oEmbed discovery URL (video pages) so editors that unfurl links can embed the player. */
  oembed?: string;
  title: string;
  description: string;
  canonical: string;
  robots: string;
  ogType: string;
  image: string | null;
  video?: { url: string; type: string } | null;
  jsonLd: unknown[];
}

export function videoMeta(origin: string, v: VideoSeoInput, opts: { noindex?: boolean } = {}): PageMeta {
  const canonical = `${origin}/v/${encodeURIComponent(v.id)}`;
  const title = truncate(v.title || 'Untitled video', 60);
  const description = truncate(v.description || `Watch "${v.title || 'this video'}" on ${SITE_NAME} — creative short videos that link to products.`, 160);
  const upload = v.createdAt.toISOString();
  const duration = isoDuration(v.duration);

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: v.title || 'Untitled video',
    description: truncate(v.description || v.title || SITE_NAME, 500),
    thumbnailUrl: v.thumbnailUrl ? [v.thumbnailUrl] : undefined,
    uploadDate: upload,
    contentUrl: v.contentUrl,
    embedUrl: canonical,
    url: canonical,
    ...(duration ? { duration } : {}),
    ...(v.hashtags.length ? { keywords: v.hashtags.join(', ') } : {}),
    ...(v.creator ? { author: { '@type': 'Person', name: v.creator.name, url: v.creator.url } } : {}),
    publisher: { '@type': 'Organization', name: SITE_NAME, url: origin },
    interactionStatistic: [
      { '@type': 'InteractionCounter', interactionType: { '@type': 'WatchAction' }, userInteractionCount: v.views },
      { '@type': 'InteractionCounter', interactionType: { '@type': 'LikeAction' }, userInteractionCount: v.likes },
      { '@type': 'InteractionCounter', interactionType: { '@type': 'CommentAction' }, userInteractionCount: v.comments },
    ],
  };
  // A video without a thumbnail isn't eligible for video rich results; drop the key rather than emit undefined.
  if (!v.thumbnailUrl) delete jsonLd.thumbnailUrl;

  return {
    title: `${title} · ${SITE_NAME}`,
    description,
    canonical,
    robots: opts.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-video-preview:-1',
    ogType: 'video.other',
    image: v.thumbnailUrl,
    video: { url: v.contentUrl, type: /\.webm(\?|$)/i.test(v.contentUrl) ? 'video/webm' : 'video/mp4' },
    jsonLd: [jsonLd],
    oembed: `${origin}/api/oembed?format=json&url=${encodeURIComponent(canonical)}`,
  };
}

const LEGAL_PAGES: Record<string, { title: string; description: string }> = {
  terms: { title: 'Terms of Service', description: `The terms for using ${SITE_NAME}: your account, your videos, and acceptable use.` },
  privacy: { title: 'Privacy Policy', description: `How ${SITE_NAME} collects, uses and protects your information.` },
  dmca: { title: 'Copyright & DMCA', description: `How to report content on ${SITE_NAME} that infringes your copyright.` },
};

/** Meta for the non-video public pages: the home page and the legal pages. Null for anything else. */
export function staticPageMeta(origin: string, pathname: string): PageMeta | null {
  const image = `${origin}/og-default.png`;
  if (pathname === '/') {
    return {
      title: `${SITE_NAME} — creative videos that link to products`,
      description: DEFAULT_DESCRIPTION,
      canonical: `${origin}/`,
      robots: 'index, follow, max-image-preview:large',
      ogType: 'website',
      image,
      jsonLd: [
        { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: `${origin}/`, description: DEFAULT_DESCRIPTION, inLanguage: 'en' },
        { '@context': 'https://schema.org', '@type': 'Organization', name: SITE_NAME, url: `${origin}/`, logo: `${origin}/icon.svg` },
      ],
    };
  }
  const m = /^\/legal\/([a-z]+)\/?$/.exec(pathname);
  const page = m && LEGAL_PAGES[m[1]];
  if (page) {
    return { title: `${page.title} · ${SITE_NAME}`, description: page.description, canonical: `${origin}/legal/${m![1]}`, robots: 'index, follow', ogType: 'website', image, jsonLd: [] };
  }
  return null;
}

export function notFoundMeta(origin: string): PageMeta {
  return {
    title: `Video not found · ${SITE_NAME}`,
    description: DEFAULT_DESCRIPTION,
    canonical: `${origin}/`,
    robots: 'noindex, nofollow',
    ogType: 'website',
    image: null,
    jsonLd: [],
  };
}

/** Serialises JSON-LD safely for embedding inside a <script> element. */
export function jsonLdScript(data: unknown): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<script type="application/ld+json" data-seo>${json}</script>`;
}

/** The <head> tags for a page, every one marked data-seo so the client can replace them. */
export function renderHeadTags(meta: PageMeta, siteName = SITE_NAME): string {
  const t: string[] = [];
  t.push(`<title data-seo>${escapeHtml(meta.title)}</title>`);
  t.push(`<meta name="description" content="${escapeHtml(meta.description)}" data-seo />`);
  t.push(`<meta name="robots" content="${escapeHtml(meta.robots)}" data-seo />`);
  t.push(`<link rel="canonical" href="${escapeHtml(meta.canonical)}" data-seo />`);
  t.push(`<meta property="og:site_name" content="${escapeHtml(siteName)}" data-seo />`);
  t.push(`<meta property="og:type" content="${escapeHtml(meta.ogType)}" data-seo />`);
  t.push(`<meta property="og:title" content="${escapeHtml(meta.title)}" data-seo />`);
  t.push(`<meta property="og:description" content="${escapeHtml(meta.description)}" data-seo />`);
  t.push(`<meta property="og:url" content="${escapeHtml(meta.canonical)}" data-seo />`);
  if (meta.image) {
    t.push(`<meta property="og:image" content="${escapeHtml(meta.image)}" data-seo />`);
    t.push(`<meta name="twitter:image" content="${escapeHtml(meta.image)}" data-seo />`);
  }
  if (meta.video) {
    t.push(`<meta property="og:video" content="${escapeHtml(meta.video.url)}" data-seo />`);
    t.push(`<meta property="og:video:secure_url" content="${escapeHtml(meta.video.url)}" data-seo />`);
    t.push(`<meta property="og:video:type" content="${escapeHtml(meta.video.type)}" data-seo />`);
  }
  if (meta.oembed) t.push(`<link rel="alternate" type="application/json+oembed" href="${escapeHtml(meta.oembed)}" title="${escapeHtml(meta.title)}" data-seo />`);
  t.push(`<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}" data-seo />`);
  t.push(`<meta name="twitter:title" content="${escapeHtml(meta.title)}" data-seo />`);
  t.push(`<meta name="twitter:description" content="${escapeHtml(meta.description)}" data-seo />`);
  for (const block of meta.jsonLd) t.push(jsonLdScript(block));
  return t.join('\n    ');
}

/**
 * Puts the page's SEO tags into the SPA shell: removes the shell's own
 * data-seo defaults (and its plain <title> / description if untagged) and
 * inserts the page's tags just before </head>.
 */
export function injectHead(shellHtml: string, meta: PageMeta): string {
  let html = shellHtml
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>\s*/gi, '')
    .replace(/<meta\b[^>]*\bname=["']description["'][^>]*>\s*/gi, '')
    .replace(/<(meta|link)\b[^>]*\bdata-seo\b[^>]*>\s*/gi, '')
    .replace(/<script\b[^>]*\bdata-seo\b[^>]*>[\s\S]*?<\/script>\s*/gi, '');
  const tags = renderHeadTags(meta);
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `    ${tags}\n  </head>`) : `${tags}\n${html}`;
}

export interface SitemapVideo {
  id: string;
  title: string;
  description: string;
  contentUrl: string;
  thumbnailUrl: string | null;
  duration: number | null;
  createdAt: Date;
  views: number;
}

export function buildSitemap(origin: string, staticPaths: string[], videos: SitemapVideo[]): string {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">');
  for (const p of staticPaths) out.push(`  <url><loc>${escapeXml(origin + p)}</loc></url>`);
  for (const v of videos) {
    // Google requires thumbnail_loc, title, description and content_loc or player_loc; skip entries that can't satisfy that.
    if (!v.thumbnailUrl || !v.contentUrl) {
      out.push(`  <url><loc>${escapeXml(`${origin}/v/${encodeURIComponent(v.id)}`)}</loc><lastmod>${v.createdAt.toISOString()}</lastmod></url>`);
      continue;
    }
    const dur = v.duration && v.duration >= 1 ? Math.min(28800, Math.round(v.duration)) : null;
    out.push(
      [
        '  <url>',
        `    <loc>${escapeXml(`${origin}/v/${encodeURIComponent(v.id)}`)}</loc>`,
        `    <lastmod>${v.createdAt.toISOString()}</lastmod>`,
        '    <video:video>',
        `      <video:thumbnail_loc>${escapeXml(v.thumbnailUrl)}</video:thumbnail_loc>`,
        `      <video:title>${escapeXml(truncate(v.title || 'Untitled video', 100))}</video:title>`,
        `      <video:description>${escapeXml(truncate(v.description || v.title || SITE_NAME, 2000))}</video:description>`,
        `      <video:content_loc>${escapeXml(v.contentUrl)}</video:content_loc>`,
        ...(dur ? [`      <video:duration>${dur}</video:duration>`] : []),
        `      <video:view_count>${Math.max(0, Math.floor(v.views))}</video:view_count>`,
        `      <video:publication_date>${v.createdAt.toISOString()}</video:publication_date>`,
        '    </video:video>',
        '  </url>',
      ].join('\n')
    );
  }
  out.push('</urlset>');
  return out.join('\n');
}

export function buildRobots(origin: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    '# Admin dashboard, API and account flows are not for search engines.',
    'Disallow: /const/',
    'Disallow: /admin',
    'Disallow: /api/',
    'Disallow: /reset-password',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}
