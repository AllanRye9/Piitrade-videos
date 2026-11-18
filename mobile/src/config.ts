/**
 * Build-time configuration. Expo inlines EXPO_PUBLIC_* variables into the
 * JS bundle, so set EXPO_PUBLIC_API_BASE_URL in .env (local) or as the
 * API_BASE_URL repository variable (CI — see .github/workflows/android-apk.yml).
 */
export const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');

/**
 * This app's own public website — used for share links and the legal pages.
 * Set EXPO_PUBLIC_WEB_URL; falls back to the API host (the usual setup when the
 * web app and API share an origin). The marketplaces videos link to are NOT
 * configured here: they come from the backend (Admin → Sites).
 */
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL || API_BASE).replace(/\/$/, '');

/** Keep in sync with MAX_VIDEO_SECONDS in backend/src/lib/videoLimits.ts. */
export const MAX_VIDEO_SECONDS = 60;

/** Resolves a backend-relative path (e.g. `/uploads/videos/x.mp4`) against API_BASE; absolute URLs (R2) pass through. */
export function mediaUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
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
