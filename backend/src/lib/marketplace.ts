import { HttpError } from './httpError';
import { listActiveSites, SiteRecord } from './sites';
import { listingUrlFor, searchUrlFor } from './siteUrls';

/**
 * Client for the marketplaces ("Sites") that videos link to, used to turn
 * "what's in this video frame" (or a typed search) into real listings the
 * viewer can open on the marketplace itself.
 *
 * Which sites exist is NOT hardcoded: admins add them in Admin → Sites (see
 * lib/sites.ts). A site with apiType "piitrade" exposes the classifieds API
 * described below at its `apiUrl` (the site's BACKEND — not its website);
 * a "link-only" site has no API, so searching just offers a link to its own
 * search page.
 *
 * These are classifieds-style marketplaces: there is no cart, stock count,
 * checkout or order for this app to place. This module is read-only — it
 * searches listings, and every result carries a `listingUrl` that opens the
 * listing on the site, where the viewer contacts the seller through the site's
 * own messaging, subject to its own terms and safety rules.
 *
 * Endpoint used:
 *
 *   GET /api/listings?q=<text>&sort=relevance&limit=12&country=<COUNTRY>
 *     -> 200 { listings: Listing[], pagination: {...} }
 *     q, sort, limit and country are real supported params on this
 *     path. `country` is only sent when MARKETPLACE_COUNTRY is set.
 *
 * The only listing fields this relies on are id, title, price, and an
 * image (productImages[].cdnUrl, or the legacy images[0]). Everything
 * else shown on a result card (location, condition, seller/store
 * name, verified badge, original price) is OPTIONAL enrichment, read
 * defensively from the field names below, and simply omitted when the
 * API doesn't return it — see toResult().
 *
 * Error responses from this backend use `{ message: string }` (not
 * `{ error }`) — see its errorHandler.ts.
 */

const REQUEST_TIMEOUT_MS = 15_000;

export interface SiteRef {
  slug: string;
  name: string;
}

/** A listing from a connected site as shown on a result card in the video feed. */
export interface MarketplaceProduct {
  id: string;
  name: string;
  /** Display price, e.g. "UGX 800,000". */
  price: string;
  /** Display original price when the seller has reduced it, e.g. "UGX 900,000". */
  originalPrice?: string;
  image: string;
  description: string;
  /** Where to open this listing on its site. */
  listingUrl: string;
  site: SiteRef;
  location?: string;
  condition?: string;
  sellerName?: string;
  storeName?: string;
  verifiedSeller?: boolean;
  featured?: boolean;
}

function baseUrl(site: SiteRecord): string {
  if (!site.apiUrl) throw new HttpError(503, `${site.name} has no API configured`);
  return site.apiUrl.replace(/\/+$/, '');
}

async function request(site: SiteRecord, path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${baseUrl(site)}${path}`, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new HttpError(504, `${site.name} timed out`);
    }
    throw new HttpError(502, `Could not reach ${site.name}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function readError(res: Response): Promise<string | undefined> {
  const body = (await res.json().catch(() => null)) as { message?: string; errors?: Array<{ msg?: string }> } | null;
  if (body?.message) return body.message;
  if (Array.isArray(body?.errors) && body.errors.length > 0) return body.errors[0]?.msg;
  return undefined;
}

/**
 * `productImages[].cdnUrl` is confirmed to already be an absolute URL.
 * The legacy `images[0]` fallback is NOT — it's a path relative to the
 * marketplace's OWN backend (MARKETPLACE_API), not to this app's
 * backend. Left unresolved, the frontend's mediaUrl() would prefix it
 * with this app's own API_BASE instead, pointing at the wrong host
 * entirely and rendering as a broken image on every listing that falls
 * into that fallback. This is the one place that decides what ends up
 * in a listing's `image` field.
 */
export function resolveMarketplaceImageUrl(raw: string | null | undefined, site: SiteRecord): string {
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  const base = baseUrl(site);
  return `${base}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

/** "UGX 800,000" — "<CURRENCY> <grouped number>". The currency is the listing's own, else the site's default. */
export function formatPrice(price: unknown, currency?: string | null, siteCurrency?: string | null): string {
  const value = typeof price === 'number' ? price : Number(price);
  const code = (currency || siteCurrency || '').toUpperCase();
  if (!code) return Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value) : '';
  if (!Number.isFinite(value)) return code;
  return `${code} ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)}`;
}

/** First non-empty string among the given values. */
function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const v of values) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function titleCase(s: string): string {
  const spaced = s.replace(/[_-]+/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface RawListing {
  id: string;
  title: string;
  description?: string;
  price: number;
  currency?: string;
  status?: string;
  images?: string[];
  productImages?: Array<{ cdnUrl: string | null }>;
  // Optional enrichment — names are best-effort, absence is fine.
  location?: unknown;
  city?: unknown;
  condition?: unknown;
  originalPrice?: unknown;
  compareAtPrice?: unknown;
  isFeatured?: unknown;
  featured?: unknown;
  user?: { id?: string; name?: unknown; isVerified?: unknown; verified?: unknown; kycVerified?: unknown };
  store?: { name?: unknown };
  storeName?: unknown;
}

function toResult(l: RawListing, site: SiteRecord): MarketplaceProduct {
  const originalPrice = firstNumber(l.originalPrice, l.compareAtPrice);
  const condition = firstString(l.condition);
  return {
    id: l.id,
    name: l.title,
    price: formatPrice(l.price, l.currency, site.currency),
    originalPrice: originalPrice !== undefined && originalPrice > l.price ? formatPrice(originalPrice, l.currency, site.currency) : undefined,
    image: resolveMarketplaceImageUrl(l.productImages?.find((img) => img.cdnUrl)?.cdnUrl || l.images?.[0], site),
    description: l.description || '',
    listingUrl: listingUrlFor(site, l.id),
    site: { slug: site.slug, name: site.name },
    location: firstString(l.location, l.city),
    condition: condition ? titleCase(condition) : undefined,
    sellerName: firstString(l.user?.name),
    storeName: firstString(l.store?.name, l.storeName),
    verifiedSeller: l.user ? Boolean(l.user.isVerified ?? l.user.verified ?? l.user.kycVerified) : undefined,
    featured: Boolean(l.isFeatured ?? l.featured) || undefined,
  };
}

export interface MarketplaceSearchResultDto {
  id: string;
  name: string;
  price: string;
  originalPrice?: string;
  category: string;
  image: string;
  description?: string;
  /** Opens this listing (or, for the local demo catalog, a search) on the site. */
  listingUrl: string;
  site?: SiteRef;
  location?: string;
  condition?: string;
  sellerName?: string;
  storeName?: string;
  verifiedSeller?: boolean;
  featured?: boolean;
  /** Only set by the local perceptual-hash fallback, where it is a real similarity score. */
  match?: number;
}

/** Shared shape mapper used by every route that turns a MarketplaceProduct
 *  into what SearchResultsPanel renders — factored out so visual search and
 *  manual text search can't drift into two different response shapes. */
export function toSearchResultDto(p: MarketplaceProduct, category: string): MarketplaceSearchResultDto {
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    originalPrice: p.originalPrice,
    category,
    image: p.image,
    description: p.description,
    listingUrl: p.listingUrl,
    site: p.site,
    location: p.location,
    condition: p.condition,
    sellerName: p.sellerName,
    storeName: p.storeName,
    verifiedSeller: p.verifiedSeller,
    featured: p.featured,
  };
}

/** Link to the full result set for `query` on a site ("See all on <site>"). */
export function browseUrlFor(site: SiteRecord, query: string): string {
  return searchUrlFor(site, query);
}

export async function searchProducts(site: SiteRecord, query: string): Promise<MarketplaceProduct[]> {
  const params = new URLSearchParams({ q: query, sort: 'relevance', limit: '12' });
  if (site.country) params.set('country', site.country);
  const path = `/api/listings?${params.toString()}`;
  console.log(`[Marketplace:${site.slug}] GET ${path}`);
  const startedAt = Date.now();

  const res = await request(site, path, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  console.log(`[Marketplace:${site.slug}] responded ${res.status} in ${Date.now() - startedAt}ms`);

  if (!res.ok) {
    const message = (await readError(res)) || `Marketplace search returned ${res.status}`;
    console.error(`[Marketplace:${site.slug}] search failed: ${message}`);
    throw new HttpError(res.status === 401 || res.status === 403 ? res.status : 502, message);
  }

  const data = (await res.json()) as { listings?: RawListing[] };
  const listings = Array.isArray(data.listings) ? data.listings : [];

  // A sold/expired/removed ad is a dead end for someone who just
  // watched a video of it — only surface listings that are live. A
  // listing with no status field at all is assumed live (the search
  // endpoint is itself expected to return active ads).
  const live = listings.filter((l) => !l.status || l.status === 'ACTIVE');
  const results = live.map((l) => toResult(l, site));

  console.log(
    `[Marketplace:${site.slug}] ${results.length} live listing(s) for "${query}"` +
      (results.length > 0 ? `: ${results.slice(0, 5).map((r) => `"${r.name}" (${r.id})`).join(', ')}${results.length > 5 ? ', …' : ''}` : '')
  );
  return results;
}

/**
 * The marketplace's own search does a verbatim, case-insensitive
 * SUBSTRING match of the ENTIRE query string against title/description
 * (confirmed directly against its route source — Prisma
 * `contains: q, mode: 'insensitive'`, not word-tokenized or fuzzy). A
 * multi-word AI-generated identification like "Vintage Wooden Dining
 * Chair with Carved Legs" will almost never appear verbatim inside a
 * real listing's title (e.g. "Wooden Dining Chair") — so searching
 * with the raw identification text alone returns 0 results even when
 * a genuinely matching item exists.
 *
 * The fix tries progressively narrower slices of the text until one
 * of them is short/precise enough to actually be a substring of the
 * real title. A prefix-only ladder (first 7 words, first 5, ...) is
 * NOT enough on its own: it was tested against a simulated backend
 * and failed exactly the case above, because "Vintage" leads every
 * prefix candidate, and the real title has no "Vintage" in it at all
 * — every prefix still contains that leading word and never becomes a
 * pure substring match. So this tries three kinds of candidates, in
 * order from most to least specific:
 *
 *   1. The full text.
 *   2. Prefixes (first 7/5/3/2 words) AND suffixes (last 7/5/3/2
 *      words) — covers the core noun phrase sitting at either end of
 *      the AI's description (leading adjectives vs. trailing
 *      qualifiers).
 *   3. Each individual meaningful word in the text, in order (common
 *      stopwords filtered out — a single hit on "with" or "and" would
 *      match nearly everything and isn't a meaningful result).
 *
 * It stops at the first candidate that returns ANY result. Trade-off:
 * a query with genuinely no match makes several sequential marketplace
 * requests (capped — see MAX_LADDER_ATTEMPTS) before giving up; that
 * cost only applies to the true-miss case, and a real match is usually
 * found in the first 1-3 attempts.
 */
const FALLBACK_WORD_COUNTS = [7, 5, 3, 2];
const MAX_LADDER_ATTEMPTS = 10;
const STOPWORDS = new Set(['a', 'an', 'the', 'with', 'and', 'or', 'for', 'of', 'in', 'on', 'at', 'to', 'is', 'this', 'that']);

export interface MarketplaceSearchOutcome {
  results: MarketplaceProduct[];
  /** Which query in the ladder actually produced results — null if none did. */
  matchedQuery: string | null;
  /** Every query tried, in order, with how many results each returned — for logging/debugging. */
  attempts: Array<{ query: string; count: number }>;
}

function buildQueryLadder(rawQuery: string): string[] {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];
  const words = trimmed.split(/\s+/);
  const candidates = [trimmed];

  for (const n of FALLBACK_WORD_COUNTS) {
    if (words.length > n) {
      candidates.push(words.slice(0, n).join(' ')); // prefix
      candidates.push(words.slice(-n).join(' ')); // suffix
    }
  }
  for (const word of words) {
    const cleaned = word.replace(/[.,!?;:()]/g, '');
    if (cleaned.length > 1 && !STOPWORDS.has(cleaned.toLowerCase())) candidates.push(cleaned);
  }

  // Dedupe while preserving priority order (most-specific first), and
  // cap the total so a true miss can't make an unbounded number of
  // sequential requests.
  return Array.from(new Set(candidates)).slice(0, MAX_LADDER_ATTEMPTS);
}

export async function searchProductsWithFallback(site: SiteRecord, rawQuery: string): Promise<MarketplaceSearchOutcome> {
  const ladder = buildQueryLadder(rawQuery);
  const attempts: Array<{ query: string; count: number }> = [];

  for (const candidate of ladder) {
    const results = await searchProducts(site, candidate);
    attempts.push({ query: candidate, count: results.length });
    if (results.length > 0) {
      if (candidate !== ladder[0]) {
        console.log(`[Marketplace:${site.slug}] fallback: no match on full text "${ladder[0]}", matched on shortened query "${candidate}"`);
      }
      return { results, matchedQuery: candidate, attempts };
    }
  }

  console.log(
    `[Marketplace:${site.slug}] no results for "${rawQuery}" after trying ${attempts.length} quer${attempts.length === 1 ? 'y' : 'ies'}: ` +
      attempts.map((a) => `"${a.query}"`).join(', ')
  );
  return { results: [], matchedQuery: null, attempts };
}


/** What one site contributed to a multi-site search. */
export interface SiteSearchSummary {
  slug: string;
  name: string;
  /** "See all on <site>" for the query that matched (or the original one). */
  browseUrl: string;
  count: number;
  /** "link-only" sites (no API) can only offer the browse link. */
  linkOnly: boolean;
  error?: string;
}

export interface MultiSiteOutcome {
  results: MarketplaceProduct[];
  matchedQuery: string | null;
  sites: SiteSearchSummary[];
  /** Convenience: the browse link of the first site that returned results, else of the first site. */
  browseUrl: string;
}

const MAX_RESULTS_TOTAL = 24;
const MAX_RESULTS_PER_SITE = 12;

/**
 * Searches every active site (or just `onlySlug`) in parallel. API sites return
 * live listings; link-only sites contribute only their browse link. One slow or
 * broken site never blocks the others — its error is reported in `sites`.
 * Results are interleaved round-robin so no single site fills the whole panel.
 */
export async function searchSites(rawQuery: string, onlySlug?: string): Promise<MultiSiteOutcome> {
  let sites = await listActiveSites();
  if (onlySlug) sites = sites.filter((s) => s.slug === onlySlug);
  if (sites.length === 0) throw new HttpError(503, onlySlug ? 'That site is not available' : 'No sites are connected yet — add one in Admin → Sites');

  const settled = await Promise.all(
    sites.map(async (site) => {
      const linkOnly = site.apiType !== 'piitrade' || !site.apiUrl;
      if (linkOnly) {
        return { site, linkOnly, outcome: null as MarketplaceSearchOutcome | null, error: undefined as string | undefined };
      }
      try {
        return { site, linkOnly, outcome: await searchProductsWithFallback(site, rawQuery), error: undefined as string | undefined };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Search failed';
        console.error(`[Marketplace:${site.slug}] ${message}`);
        return { site, linkOnly, outcome: null as MarketplaceSearchOutcome | null, error: message };
      }
    })
  );

  const summaries: SiteSearchSummary[] = settled.map(({ site, linkOnly, outcome, error }) => ({
    slug: site.slug,
    name: site.name,
    browseUrl: browseUrlFor(site, outcome?.matchedQuery || rawQuery),
    count: Math.min(outcome?.results.length ?? 0, MAX_RESULTS_PER_SITE),
    linkOnly,
    ...(error ? { error } : {}),
  }));

  const lists = settled.map((s) => s.outcome?.results.slice(0, MAX_RESULTS_PER_SITE) ?? []);
  const results: MarketplaceProduct[] = [];
  for (let i = 0; results.length < MAX_RESULTS_TOTAL; i++) {
    let added = false;
    for (const list of lists) {
      if (i < list.length && results.length < MAX_RESULTS_TOTAL) {
        results.push(list[i]);
        added = true;
      }
    }
    if (!added) break;
  }

  const firstHit = settled.find((s) => s.outcome && s.outcome.results.length > 0);
  return {
    results,
    matchedQuery: firstHit?.outcome?.matchedQuery ?? null,
    sites: summaries,
    browseUrl: (summaries.find((s) => s.count > 0) ?? summaries[0]).browseUrl,
  };
}
