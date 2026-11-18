/**
 * Shoppable moments: several products pinned to one video, each optionally
 * limited to a time window and placed at a spot on the frame.
 *
 * validateProducts() is pure (unit-tested in test/videoProducts.test.js); the
 * rest talks to the DB. The first product is mirrored into Video.siteId /
 * productUrl / productTitle so older app builds, which only know the single
 * link, keep working.
 */
import { prisma } from '../db';
import { HttpError } from './httpError';
import { listActiveSites, resolveVideoLink, SiteRecord, VideoLinkFields } from './sites';
import { SiteLike, SiteValidationError, matchSiteByUrl, normalizeProductUrl, stripTrackingParams, urlBelongsToSite } from './siteUrls';

export const MAX_PRODUCTS_PER_VIDEO = 8;

export interface ProductInput {
  siteId: string;
  url: string;
  title: string | null;
  startMs: number;
  endMs: number | null;
  x: number | null;
  y: number | null;
  position: number;
}

export interface ProductPlan {
  products: ProductInput[];
  /** Value for the legacy single-link columns on Video. */
  mirror: VideoLinkFields;
}

function intOrNull(v: unknown, label: string): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new SiteValidationError(`${label} must be a number`);
  return Math.trunc(n);
}

function fraction(v: unknown, label: string): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new SiteValidationError(`${label} must be between 0 and 1`);
  return Math.round(n * 1000) / 1000;
}

/** Validates the products a client sent. `sites` are the active sites; `durationMs` (if known) bounds the time windows. */
export function validateProducts(raw: unknown, sites: SiteLike[], durationMs?: number | null): ProductInput[] {
  if (!Array.isArray(raw)) throw new SiteValidationError('products must be a list');
  if (raw.length > MAX_PRODUCTS_PER_VIDEO) throw new SiteValidationError(`A video can have at most ${MAX_PRODUCTS_PER_VIDEO} products`);

  return raw.map((item, i): ProductInput => {
    const n = i + 1;
    if (!item || typeof item !== 'object') throw new SiteValidationError(`Product ${n} is invalid`);
    const o = item as Record<string, unknown>;

    const url = stripTrackingParams(normalizeProductUrl(o.url));
    let site: SiteLike | null = null;
    const ref = String(o.siteId ?? o.site ?? '').trim();
    if (ref) {
      site = sites.find((s) => s.id === ref || s.slug === ref) ?? null;
      if (!site) throw new SiteValidationError(`Product ${n}: that site is not available`);
      if (!urlBelongsToSite(url, site)) throw new SiteValidationError(`Product ${n}: the link must be a page on ${site.name} (${site.siteUrl})`);
    } else {
      site = matchSiteByUrl(url, sites);
      if (!site) throw new SiteValidationError(`Product ${n}: that link is not on one of the connected sites`);
    }

    const startMs = intOrNull(o.startMs, `Product ${n}: start time`) ?? 0;
    let endMs = intOrNull(o.endMs, `Product ${n}: end time`);
    if (startMs < 0) throw new SiteValidationError(`Product ${n}: start time can't be negative`);
    if (durationMs != null) {
      if (startMs >= durationMs) throw new SiteValidationError(`Product ${n}: it starts after the video ends`);
      if (endMs != null && endMs > durationMs) endMs = Math.trunc(durationMs);
    }
    if (endMs != null && endMs <= startMs) throw new SiteValidationError(`Product ${n}: the end time must be after the start time`);

    const x = fraction(o.x, `Product ${n}: x`);
    const y = fraction(o.y, `Product ${n}: y`);
    if ((x === null) !== (y === null)) throw new SiteValidationError(`Product ${n}: give both x and y, or neither`);

    return { siteId: site.id, url, title: String(o.title ?? '').trim().slice(0, 120) || null, startMs, endMs, x, y, position: i };
  });
}

export function mirrorOf(products: ProductInput[]): VideoLinkFields {
  const first = products[0];
  return first ? { siteId: first.siteId, productUrl: first.url, productTitle: first.title } : { siteId: null, productUrl: null, productTitle: null };
}

/** Accepts an array, or a JSON string (multipart forms send fields as text). undefined = not provided. */
export function parseProductsField(raw: unknown): unknown[] | undefined {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v;
    } catch {
      /* fall through */
    }
  }
  throw new HttpError(400, 'products must be a JSON list');
}

/**
 * Works out what a create/edit request wants done with a video's products.
 * - `products` present: that list replaces the current one.
 * - only the old single-link fields present (older apps): treated as a one-product list covering the whole video
 *   (a site with no product page becomes a link to the site's home page).
 * - neither: null (leave the products alone).
 */
export async function resolveProductPlan(
  body: Record<string, unknown>,
  current?: Partial<VideoLinkFields>,
  durationMs?: number | null
): Promise<ProductPlan | null> {
  const list = parseProductsField(body.products);
  const sites = await listActiveSites();
  try {
    if (list !== undefined) {
      const products = validateProducts(list, sites, durationMs);
      return { products, mirror: mirrorOf(products) };
    }
    const link = await resolveVideoLink(body, current);
    if (!link) return null;
    if (!link.siteId) return { products: [], mirror: link };
    const site = sites.find((s) => s.id === link.siteId);
    const url = link.productUrl || (site ? `${site.siteUrl}/` : null);
    if (!url) return { products: [], mirror: link };
    return { products: [{ siteId: link.siteId, url, title: link.productTitle, startMs: 0, endMs: null, x: null, y: null, position: 0 }], mirror: link };
  } catch (err) {
    if (err instanceof SiteValidationError) throw new HttpError(400, err.message);
    throw err;
  }
}

/** Drops products that start after the video (it may have been trimmed) and caps end times at its length. */
export function fitPlanToDuration(plan: ProductPlan, durationMs: number): ProductPlan {
  const products = plan.products
    .filter((p) => p.startMs < durationMs)
    .map((p) => (p.endMs != null && p.endMs > durationMs ? { ...p, endMs: Math.trunc(durationMs) } : p))
    .map((p, i) => ({ ...p, position: i }));
  return products.length === plan.products.length ? { ...plan, products } : { products, mirror: mirrorOf(products) };
}

/** Prisma `data` fragment for video.create. */
export function productCreateData(plan: ProductPlan | null) {
  if (!plan) return {};
  return { ...plan.mirror, products: { create: plan.products.map((p) => ({ ...p })) } };
}

/** Replaces a video's products (and the legacy mirror) in one transaction. */
export async function replaceProducts(videoId: string, plan: ProductPlan) {
  await prisma.$transaction([
    prisma.videoProduct.deleteMany({ where: { videoId } }),
    ...(plan.products.length ? [prisma.videoProduct.createMany({ data: plan.products.map((p) => ({ ...p, videoId })) })] : []),
    prisma.video.update({ where: { id: videoId }, data: plan.mirror }),
  ]);
}

export interface PublicProduct {
  id: string;
  title: string | null;
  url: string;
  site: { slug: string; name: string } | null;
  go: string;
  startMs: number;
  endMs: number | null;
  x: number | null;
  y: number | null;
}

type ProductRow = { id: string; videoId: string; siteId: string; url: string; title: string | null; startMs: number; endMs: number | null; x: number | null; y: number | null; position: number };

/** Loads products for many videos in one query: videoId -> rows, in display order. */
export async function loadProductsFor(videoIds: string[]): Promise<Map<string, ProductRow[]>> {
  const out = new Map<string, ProductRow[]>();
  if (videoIds.length === 0) return out;
  const rows: ProductRow[] = await prisma.videoProduct.findMany({ where: { videoId: { in: videoIds } }, orderBy: [{ startMs: 'asc' }, { position: 'asc' }] });
  for (const r of rows) {
    const list = out.get(r.videoId);
    if (list) list.push(r);
    else out.set(r.videoId, [r]);
  }
  return out;
}

export type { SiteRecord };
