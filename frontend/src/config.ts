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
 * `https://api.yourapp.com` (no trailing slash). Every API call and
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
