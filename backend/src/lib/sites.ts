import crypto from 'crypto';
import { prisma } from '../db';
import { HttpError } from './httpError';
import { SiteLike, SiteValidationError, matchSiteByUrl, normalizeProductUrl, urlBelongsToSite } from './siteUrls';

/**
 * Cached access to the admin-managed Sites (see siteUrls.ts for the pure URL
 * helpers). The list is tiny and read on almost every request (video
 * serialisation, product search), so it is cached in memory for a short time
 * and invalidated whenever an admin changes a site.
 */
export type SiteRecord = SiteLike;

const TTL_MS = 30_000;
let cache: { at: number; sites: SiteRecord[] } | null = null;
let inflight: Promise<SiteRecord[]> | null = null;

/** Marks the cache stale after an admin change and refreshes it in the background; sync lookups keep serving the old list meanwhile. */
export function invalidateSites(): void {
  if (cache) cache.at = 0;
  void listSites().catch(() => undefined);
}

/** All sites (active and inactive), ordered by position then name. */
export async function listSites(): Promise<SiteRecord[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.sites;
  if (inflight) return inflight;
  const p: Promise<SiteRecord[]> = prisma.site
    .findMany({ orderBy: [{ position: 'asc' }, { name: 'asc' }] })
    .then((rows: SiteRecord[]) => {
      cache = { at: Date.now(), sites: rows };
      return rows;
    })
    .finally(() => {
      inflight = null;
    });
  inflight = p;
  return p;
}

/** Starts the periodic refresh so getSiteSync() stays warm and picks up changes made by other instances. */
export function startSiteRefresh(): void {
  void listSites().catch((e) => console.error('[Sites] initial load failed', e));
  setInterval(() => void listSites().catch(() => undefined), 20_000).unref();
}

export async function listActiveSites(): Promise<SiteRecord[]> {
  return (await listSites()).filter((s) => s.active);
}

/** Synchronous lookup for hot paths (video serialisation). Empty until the first listSites() has run — warmed at startup. */
export function getSiteSync(id: string | null | undefined): SiteRecord | null {
  if (!id || !cache) return null;
  return cache.sites.find((s) => s.id === id && s.active) ?? null;
}

/** Whether any active site can be searched through an API (vs. link-only). */
export async function hasSearchableSites(): Promise<boolean> {
  return (await listActiveSites()).some((s) => s.apiType === 'piitrade' && !!s.apiUrl);
}

/**
 * One-time migration path from the old single-marketplace configuration: if
 * there are no sites yet and the legacy environment variables are set
 * (PIITRADE_SITE_URL / MARKETPLACE_API), create that site so existing
 * deployments keep working. After that, sites are managed in Admin → Sites and
 * those variables are ignored.
 */
export async function seedLegacySite(): Promise<void> {
  try {
    if ((await prisma.site.count()) > 0) return;
    const siteUrl = process.env.PIITRADE_SITE_URL?.trim();
    if (!siteUrl) return;
    const { normalizeBaseUrl } = await import('./siteUrls');
    const base = normalizeBaseUrl(siteUrl, 'PIITRADE_SITE_URL', { allowPrivate: true });
    const api = process.env.MARKETPLACE_API?.trim();
    await prisma.site.create({
      data: {
        name: new URL(base).hostname.replace(/^www\./, ''),
        slug: new URL(base).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '').slice(0, 40) || 'site',
        siteUrl: base,
        apiUrl: api ? normalizeBaseUrl(api, 'MARKETPLACE_API', { allowPrivate: true }) : '',
        apiType: api ? 'piitrade' : 'link-only',
        country: process.env.MARKETPLACE_COUNTRY || '',
        currency: process.env.MARKETPLACE_DEFAULT_CURRENCY || '',
        sellPath: '/listings/create',
        postbackSecret: crypto.randomBytes(32).toString('hex'),
      },
    });
    invalidateSites();
    console.log(`[Sites] seeded "${base}" from the legacy PIITRADE_SITE_URL / MARKETPLACE_API settings — manage sites in Admin → Sites`);
  } catch (err) {
    console.error('[Sites] could not seed the legacy site', err);
  }
}

export interface VideoLinkFields {
  siteId: string | null;
  productUrl: string | null;
  productTitle: string | null;
}

/**
 * Validates the "site + product link" a video promotes — used by the upload
 * route and the admin video editor. Returns null when the request doesn't touch
 * any of the three fields (leave the video as it is), otherwise the final
 * values to store.
 *
 *  - `siteId` may be a site id or slug; "" clears it.
 *  - `productUrl` must be http(s) AND on a connected site's domain, so videos
 *    can't be used to link anywhere on the internet. With no `siteId` the site
 *    is inferred from the link.
 *  - `productTitle` is a short label for the call-to-action (≤120 chars).
 */
export async function resolveVideoLink(body: Record<string, unknown>, current?: Partial<VideoLinkFields>): Promise<VideoLinkFields | null> {
  const touched = body.siteId !== undefined || body.productUrl !== undefined || body.productTitle !== undefined;
  if (!touched) return null;
  const sites = await listActiveSites();

  try {
    let site: SiteRecord | null = null;
    if (body.siteId !== undefined) {
      const ref = String(body.siteId ?? '').trim();
      if (ref) {
        site = sites.find((s) => s.id === ref || s.slug === ref) ?? null;
        if (!site) throw new SiteValidationError('That site is not available');
      }
    } else if (current?.siteId) {
      site = sites.find((s) => s.id === current.siteId) ?? null;
    }

    let productUrl: string | null;
    if (body.productUrl !== undefined) {
      const raw = String(body.productUrl ?? '').trim();
      productUrl = raw ? normalizeProductUrl(raw) : null;
    } else {
      productUrl = current?.productUrl ?? null;
    }

    if (productUrl) {
      if (site) {
        if (!urlBelongsToSite(productUrl, site)) throw new SiteValidationError(`The product link must be a page on ${site.name} (${site.siteUrl})`);
      } else {
        site = matchSiteByUrl(productUrl, sites);
        if (!site) throw new SiteValidationError('That link is not on one of the connected sites. Choose a site, or ask an admin to add it.');
      }
    }

    let productTitle: string | null;
    if (body.productTitle !== undefined) productTitle = String(body.productTitle ?? '').trim().slice(0, 120) || null;
    else productTitle = current?.productTitle ?? null;
    if (!productUrl) productTitle = null;

    return { siteId: site?.id ?? null, productUrl, productTitle };
  } catch (err) {
    if (err instanceof SiteValidationError) throw new HttpError(400, err.message);
    throw err;
  }
}
