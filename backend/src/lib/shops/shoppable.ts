import { hostMatchesSite, normalizeProductUrl } from './attribution';

export const MAX_PRODUCTS_PER_VIDEO = 8;

export interface SiteRef {
  id: string;
  baseUrl: string;
}

export interface ProductInput {
  url?: unknown;
  title?: unknown;
  startMs?: unknown;
  endMs?: unknown;
  x?: unknown;
  y?: unknown;
}

export interface CleanProduct {
  siteId: string;
  url: string;
  urlKey: string;
  title: string;
  startMs: number;
  endMs: number | null;
  x: number | null;
  y: number | null;
  position: number;
}

const num = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);

/**
 * Validates the products a creator pinned to a video. Every URL must be on a
 * registered, active shop (so the redirect/attribution can't be pointed at an
 * arbitrary site), times must lie inside the clip, hotspots inside the frame.
 */
export function validateProducts(input: unknown, sites: SiteRef[], durationSec: number | null): { products: CleanProduct[] } | { error: string } {
  if (input === undefined || input === null) return { products: [] };
  if (!Array.isArray(input)) return { error: 'products must be an array' };
  if (input.length > MAX_PRODUCTS_PER_VIDEO) return { error: `At most ${MAX_PRODUCTS_PER_VIDEO} products per video` };
  const maxMs = durationSec && durationSec > 0 ? Math.ceil(durationSec * 1000) : null;

  const out: CleanProduct[] = [];
  for (let i = 0; i < input.length; i++) {
    const p = (input[i] ?? {}) as ProductInput;
    const label = `Product ${i + 1}`;
    const url = typeof p.url === 'string' ? p.url.trim() : '';
    const urlKey = url ? normalizeProductUrl(url) : null;
    if (!urlKey) return { error: `${label}: a valid http(s) link is required` };
    const site = sites.find((s) => hostMatchesSite(url, s.baseUrl));
    if (!site) return { error: `${label}: that link isn’t on a connected shop` };

    const startMs = num(p.startMs) ?? 0;
    const endMs = num(p.endMs);
    if (Number.isNaN(startMs) || (endMs !== null && Number.isNaN(endMs))) return { error: `${label}: invalid time` };
    if (!Number.isInteger(startMs) || startMs < 0) return { error: `${label}: start time must be a whole number of milliseconds ≥ 0` };
    if (endMs !== null && (!Number.isInteger(endMs) || endMs <= startMs)) return { error: `${label}: end time must be after the start time` };
    if (maxMs !== null && startMs >= maxMs) return { error: `${label}: start time is past the end of the video` };
    if (maxMs !== null && endMs !== null && endMs > maxMs + 500) return { error: `${label}: end time is past the end of the video` };

    const x = num(p.x);
    const y = num(p.y);
    if ((x === null) !== (y === null)) return { error: `${label}: set both x and y or neither` };
    if (x !== null && (Number.isNaN(x) || Number.isNaN(y as number) || x < 0 || x > 1 || (y as number) < 0 || (y as number) > 1)) {
      return { error: `${label}: hotspot must be between 0 and 1` };
    }
    const title = (typeof p.title === 'string' ? p.title.trim() : '').slice(0, 120);
    out.push({ siteId: site.id, url, urlKey, title, startMs, endMs: endMs ?? null, x, y, position: i });
  }
  return { products: out };
}

export interface TimedProduct {
  id: string;
  startMs: number;
  endMs: number | null;
}

/** Products whose window contains `ms`. A product with no endMs stays up until the video ends. */
export function activeProducts<T extends TimedProduct>(products: T[], ms: number): T[] {
  return products.filter((p) => ms >= p.startMs && (p.endMs === null || p.endMs === undefined || ms < p.endMs));
}
