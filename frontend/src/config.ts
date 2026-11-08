/**
 * When the frontend and backend are served from the same origin (the
 * default Docker Compose setup — nginx proxies /api and /uploads to
 * the backend container), this stays empty and every request is a
 * plain relative path.
 *
 * When they're deployed separately (e.g. this frontend on Vercel and
 * the backend on Railway/Render/Fly/a VPS, since Vercel's serverless
 * functions can't run a stateful Postgres+ffmpeg backend), set
 * VITE_API_BASE_URL at build time to the backend's full origin, e.g.
 * `https://piitrade.com` (no trailing slash). Every API call and
 * every video/poster/product-image URL will then resolve against it
 * instead of the frontend's own origin.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

/** Resolves a backend-relative path (e.g. `/uploads/videos/x.mp4`) against API_BASE. */
export function mediaUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}

/**
 * The public piitrade.com classifieds marketplace this app is the
 * video companion of. Piitrade Videos never sells anything itself —
 * every "buy", "contact the seller", "sell" or "safety" path leads to
 * a page on this site. Override with VITE_PIITRADE_SITE_URL (no
 * trailing slash) for staging.
 */
export const PIITRADE_SITE_URL = (import.meta.env.VITE_PIITRADE_SITE_URL || 'https://piitrade.com').replace(/\/$/, '');

/** A page on piitrade.com, tagged so the marketplace can attribute the visit to the videos app. */
export function piitradeUrl(path: string): string {
  const url = new URL(`${PIITRADE_SITE_URL}${path.startsWith('/') ? '' : '/'}${path}`);
  url.searchParams.set('utm_source', 'piitrade_videos');
  url.searchParams.set('utm_medium', 'video');
  return url.toString();
}

/** The longest video that can be published, in seconds — keep in sync with MAX_VIDEO_SECONDS in backend/src/lib/videoLimits.ts. */
export const MAX_VIDEO_SECONDS = 30;
