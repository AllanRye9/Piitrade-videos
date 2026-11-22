/**
 * Where the API lives.
 *
 * - On the live site (yotweek.com) it is always https://api.yotweek.com, whatever was baked in at build
 *   time, so a stale VITE_API_BASE_URL in the hosting settings can't point the site at a dead backend.
 * - Everywhere else (the Android app, previews, local builds) it is VITE_API_BASE_URL, the backend's full
 *   origin with no trailing slash. The Android app runs from https://localhost and must set it.
 * - When the frontend and backend share an origin (Docker Compose with nginx proxying /api and /uploads)
 *   it stays empty and every request is a plain relative path.
 *
 * Every API call and every video/poster/product-image URL resolves against it.
 */
import { resolveApiBase } from './apiBase';

export { PRODUCTION_API_BASE } from './apiBase';
export const API_BASE = resolveApiBase(import.meta.env.VITE_API_BASE_URL, typeof location === 'undefined' ? undefined : location.hostname);

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
export const MAX_VIDEO_SECONDS = 60;
