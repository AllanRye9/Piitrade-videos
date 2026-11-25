// Pure (no React Native imports) so it can be unit-tested under plain Node.

/** The mobile app's host: the API (/api) and uploaded media (/uploads). It is the same backend as the website. */
export const PRODUCTION_HOST = 'v.piitrade.com';
export const DEFAULT_API_BASE = `https://${PRODUCTION_HOST}`;

/** The public website: share links (/v/<id>), legal pages, password reset and the admin site. */
export const WEB_HOST = 'videos.piitrade.com';
export const DEFAULT_WEB_URL = `https://${WEB_HOST}`;

/**
 * Hosts this project used before it moved to videos.piitrade.com. A build that still carries one of them
 * (a stale EXPO_PUBLIC_API_BASE_URL in .env.production, eas.json or the GitHub `API_BASE_URL` variable)
 * would send every request to a server that doesn't run this backend, so it answers HTTP 404 everywhere.
 * They are treated as "not configured" and resolve to the production host instead.
 */
const LEGACY_HOSTS = new Set(['yotweek.com', 'www.yotweek.com', 'api.yotweek.com']);

const unquote = (value: string | undefined): string => (value ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();

/** Parses an http(s) address. A missing scheme ("v.piitrade.com") is read as https. Anything else → null. */
function parseHttpUrl(input: string): URL | null {
  if (!input) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

const hostOf = (url: URL): string => url.hostname.toLowerCase().replace(/\.$/, '');

/** The release app blocks cleartext traffic, so plain http to one of our own hosts can never work: use https. */
const isOwnHost = (host: string): boolean => host === PRODUCTION_HOST || host === WEB_HOST;
const originOf = (url: URL): string => (isOwnHost(hostOf(url)) ? `https://${url.host}` : url.origin);

/**
 * Normalizes EXPO_PUBLIC_API_BASE_URL into a clean server origin/base without a trailing slash or `/api`
 * suffix. Every request in `api.ts` already starts with `/api/...`, so a value like
 * `https://v.piitrade.com/api` would otherwise double the prefix (`/api/api/...`) and answer HTTP 404
 * on every endpoint. Unset, blank, unparseable and legacy (yotweek) values fall back to the app's API host, and
 * so does the website's own host (videos.piitrade.com): the app always talks to v.piitrade.com in production.
 */
export function resolveApiBase(configured?: string): string {
  const url = parseHttpUrl(unquote(configured));
  if (!url) return DEFAULT_API_BASE;
  if (LEGACY_HOSTS.has(hostOf(url)) || hostOf(url) === WEB_HOST) return DEFAULT_API_BASE;
  const pathname = url.pathname.replace(/\/+$/, '');
  if (pathname === '' || /^\/api(\/|$)/i.test(pathname)) return originOf(url);
  return `${originOf(url)}${pathname}`;
}

/**
 * The public website used for share links (`<web>/v/<id>`), legal pages and the password-reset link.
 * Defaults to videos.piitrade.com. Against a custom backend (staging, a local dev server) it defaults to that
 * backend instead, since one origin serves both. A legacy (yotweek) value falls back the same way.
 */
export function resolveWebUrl(configured: string | undefined, apiBase: string): string {
  let apiHost = '';
  try { apiHost = new URL(apiBase).hostname.toLowerCase(); } catch { /* no usable API base */ }
  const fallback = !apiBase || apiHost === PRODUCTION_HOST ? DEFAULT_WEB_URL : apiBase;
  const url = parseHttpUrl(unquote(configured));
  if (!url || LEGACY_HOSTS.has(hostOf(url))) return fallback;
  return `${originOf(url)}${url.pathname.replace(/\/+$/, '')}`;
}

/** `<base><path>` with exactly one slash between them, whatever the caller wrote. */
export function buildApiUrl(apiBase: string, path: string): string {
  return `${apiBase}${path.startsWith('/') ? '' : '/'}${path}`;
}

/**
 * Turns whatever the backend sent for a video, poster or avatar into a URL the device can load:
 *  - `/uploads/videos/x.mp4` (local disk storage) → `<base>/uploads/videos/x.mp4`
 *  - `https://media…/x.mp4` (Cloudflare R2) → unchanged. An `http://` URL on our own host is upgraded to
 *    https, because the release app refuses cleartext traffic and the media would silently never load.
 *  - `//host/x` → `https://host/x`;  `uploads/x` (no leading slash) → `<base>/uploads/x`
 *  - `file:`, `content:`, `data:` and `blob:` URIs (just-picked local images) → unchanged
 */
export function resolveMediaUrl(path: string | null | undefined, apiBase: string): string | undefined {
  const raw = (path ?? '').trim();
  if (!raw) return undefined;
  if (/^(file|content|data|blob):/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return upgradeOwnHost(raw, apiBase);
  if (raw.startsWith('//')) return `https:${raw}`;
  return buildApiUrl(apiBase, raw);
}

function upgradeOwnHost(absolute: string, apiBase: string): string {
  if (!/^http:\/\//i.test(absolute)) return absolute;
  try {
    const base = new URL(apiBase);
    const url = new URL(absolute);
    if (base.protocol === 'https:' && (url.host.toLowerCase() === base.host.toLowerCase() || isOwnHost(url.hostname.toLowerCase()))) {
      url.protocol = 'https:';
      return url.toString();
    }
  } catch {
    // leave it as it was
  }
  return absolute;
}
