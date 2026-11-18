/**
 * Pure helpers for the admin-managed Sites (no DB, no network) — unit-tested in
 * test/siteUrls.test.js. A Site describes a marketplace/store that videos link
 * to; see `model Site` in prisma/schema.prisma.
 */

export interface SiteLike {
  id: string;
  name: string;
  slug: string;
  siteUrl: string;
  apiUrl: string;
  apiType: string;
  country: string;
  currency: string;
  listingPath: string;
  searchPath: string;
  sellPath: string;
  active: boolean;
  position: number;
  /** Percent of each confirmed sale owed to the creator (0–100). */
  commissionPct?: number;
  /** Secret the site signs conversion postbacks with (never sent to clients). */
  postbackSecret?: string;
}

export const API_TYPES = ['piitrade', 'link-only'] as const;
export type ApiType = (typeof API_TYPES)[number];

export const UTM_SOURCE = 'yotweek';

export class SiteValidationError extends Error {}

/** "My Shop!" → "my-shop" (3–40 chars of a-z0-9-). */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return /^[0-9a-f:]+$/.test(h);
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Validates an http(s) URL entered by an admin and returns it without a trailing
 * slash. The backend fetches `apiUrl` server-side, so private/loopback hosts are
 * refused in production (SSRF guard) — set ALLOW_PRIVATE_SITE_URLS=true to allow
 * them for local development.
 */
export function normalizeBaseUrl(raw: unknown, label: string, opts: { allowPrivate?: boolean } = {}): string {
  const text = String(raw ?? '').trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new SiteValidationError(`${label} must be a full URL starting with https://`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new SiteValidationError(`${label} must start with http:// or https://`);
  if (url.username || url.password) throw new SiteValidationError(`${label} must not contain a username or password`);
  if (!opts.allowPrivate && isPrivateHost(url.hostname)) throw new SiteValidationError(`${label} must be a public address`);
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

/** A path template like "/listings/{id}" — must start with "/" and stay on the site. */
export function normalizePathTemplate(raw: unknown, label: string, fallback: string, required: string[] = []): string {
  const text = String(raw ?? '').trim();
  if (!text) return fallback;
  if (!text.startsWith('/') || text.startsWith('//')) throw new SiteValidationError(`${label} must be a path starting with a single "/", e.g. ${fallback || '/listings'}`);
  if (/\s/.test(text)) throw new SiteValidationError(`${label} must not contain spaces`);
  for (const token of required) if (!text.includes(token)) throw new SiteValidationError(`${label} must contain ${token}`);
  return text.slice(0, 200);
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(id|q)\}/g, (_m, k: string) => encodeURIComponent(values[k] ?? ''));
}

function withUtm(url: URL, medium = 'video'): string {
  if (!url.searchParams.has('utm_source')) url.searchParams.set('utm_source', UTM_SOURCE);
  if (!url.searchParams.has('utm_medium')) url.searchParams.set('utm_medium', medium);
  return url.toString();
}

export function siteHomeUrl(site: SiteLike): string {
  return withUtm(new URL(`${site.siteUrl}/`));
}

export function listingUrlFor(site: SiteLike, listingId: string): string {
  return withUtm(new URL(site.siteUrl + fill(site.listingPath || '/listings/{id}', { id: listingId })));
}

export function searchUrlFor(site: SiteLike, query: string): string {
  const q = query.trim();
  const template = site.searchPath || '/listings?q={q}';
  const path = q ? fill(template, { q }) : template.replace(/[?&][^?&=]*=\{q\}/, '').replace(/\{q\}/g, '');
  return withUtm(new URL(site.siteUrl + path));
}

export function sellUrlFor(site: SiteLike): string | null {
  return site.sellPath ? withUtm(new URL(site.siteUrl + site.sellPath)) : null;
}

/** Hostname comparison that treats "www." and subdomains of the site as the same site. */
export function urlBelongsToSite(url: string, site: Pick<SiteLike, 'siteUrl'>): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const base = new URL(site.siteUrl).hostname.toLowerCase().replace(/^www\./, '');
    return host === base || host.endsWith(`.${base}`);
  } catch {
    return false;
  }
}

/** Finds the registered site a product link points at (the most specific host wins). */
export function matchSiteByUrl<T extends Pick<SiteLike, 'siteUrl'>>(url: string, sites: T[]): T | null {
  const matches = sites.filter((s) => urlBelongsToSite(url, s));
  matches.sort((a, b) => new URL(b.siteUrl).hostname.length - new URL(a.siteUrl).hostname.length);
  return matches[0] ?? null;
}

/** A user-supplied product link: https/http only, no credentials, ≤500 chars. Returns the cleaned URL. */
export function normalizeProductUrl(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (text.length > 500) throw new SiteValidationError('That product link is too long');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new SiteValidationError('Product link must be a full URL, e.g. https://example.com/listings/123');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new SiteValidationError('Product link must start with http:// or https://');
  if (url.username || url.password) throw new SiteValidationError('Product link must not contain a username or password');
  url.hash = '';
  return url.toString();
}

/** Removes utm_* and our own click token from a link, so the stored/compared form is the clean page address. */
export function stripTrackingParams(raw: string): string {
  try {
    const url = new URL(raw);
    for (const k of [...url.searchParams.keys()]) if (k.startsWith('utm_') || k === 'yw_click') url.searchParams.delete(k);
    url.hash = '';
    return url.toString();
  } catch {
    return raw;
  }
}

/** The spellings of a product page address a shop might use (with/without a trailing slash), for lookups. */
export function productUrlVariants(raw: string): string[] {
  const clean = stripTrackingParams(raw);
  const out = new Set<string>([clean]);
  try {
    const url = new URL(clean);
    if (!url.search && url.pathname.length > 1) {
      const alt = new URL(clean);
      alt.pathname = url.pathname.endsWith('/') ? url.pathname.replace(/\/+$/, '') : `${url.pathname}/`;
      out.add(alt.toString());
    }
  } catch {
    /* keep the one form */
  }
  return [...out];
}

/** Adds attribution (utm) parameters to a stored product link for display. */
export function productLinkForDisplay(url: string, medium = 'video'): string {
  try {
    return withUtm(new URL(url), medium);
  } catch {
    return url;
  }
}
