/**
 * Build-time configuration. Expo inlines EXPO_PUBLIC_* variables into the
 * JS bundle, so set EXPO_PUBLIC_API_BASE_URL in .env (local) or as the
 * API_BASE_URL repository variable (CI — see .github/workflows/android-apk.yml).
 */
export const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');

/** The public website — used for share links, legal pages and the password-reset link. */
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL || API_BASE || 'https://piitrade.com').replace(/\/$/, '');

export const PIITRADE_SITE_URL = (process.env.EXPO_PUBLIC_PIITRADE_SITE_URL || 'https://piitrade.com').replace(/\/$/, '');

/** Keep in sync with MAX_VIDEO_SECONDS in backend/src/lib/videoLimits.ts. */
export const MAX_VIDEO_SECONDS = 30;

/** Resolves a backend-relative path (e.g. `/uploads/videos/x.mp4`) against API_BASE; absolute URLs (R2) pass through. */
export function mediaUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}

export function piitradeUrl(path: string): string {
  const url = new URL(`${PIITRADE_SITE_URL}${path.startsWith('/') ? '' : '/'}${path}`);
  url.searchParams.set('utm_source', 'piitrade_videos_app');
  url.searchParams.set('utm_medium', 'video');
  return url.toString();
}

/**
 * Sign-in nudges for signed-out viewers. A cancellable popup appears
 * after the viewer has been *watching* for a while, then again from
 * time to time — never interrupting playback, and backing off every
 * time it is dismissed.
 */
export const NUDGE = {
  /** Seconds of actual watch time before the first popup. */
  firstAfterSeconds: 20,
  /** Watch-time gap before the 2nd popup; each later gap is multiplied by `backoff`. */
  baseGapSeconds: 60,
  backoff: 1.6,
  /** Never show more than this many nudges in one app session. */
  maxPerSession: 5,
  /** Popup closes itself after this long if ignored (it can always be dismissed earlier). */
  autoHideSeconds: 12,
};
