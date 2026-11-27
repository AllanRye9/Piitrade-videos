import { HttpError } from '../core/httpError';
import { listingUrl, searchUrl } from './piitrade';
import { hostMatchesSite } from '../shops/attribution';

/**
 * Client for the Piitrade classifieds marketplace's backend API, used
 * to turn "what's in this video frame" (or a typed search) into real
 * listings the viewer can open on piitrade.com.
 *
 * piitrade.com is a CLASSIFIEDS marketplace: there is no cart, stock
 * count, checkout or order for Piitrade Videos to place. An earlier
 * version of this file logged viewers into the marketplace and
 * created orders (POST /api/orders); all of that was removed on
 * purpose. This module is read-only — it searches listings, and every
 * result carries a `listingUrl` that opens the listing on piitrade.com,
 * where the viewer contacts the seller through the marketplace's own
 * messaging, subject to its own terms and safety rules.
 *
 * Set MARKETPLACE_API to the marketplace's BACKEND base URL — NOT the
 * piitrade.com frontend. Verified against the live site: the website
 * loads listing images from a separate Railway-hosted backend
 * (https://backend-production-a662.up.railway.app/api/images/...), and
 * https://piitrade.com/listings returns an HTML page, not JSON, so
 * pointing MARKETPLACE_API at piitrade.com fails every search with a
 * JSON-parse error. Railway hostnames can change on redeploy — see
 * .env.example for how to re-derive the current one.
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
/** Per-shop budget when several shops are searched at once: a slow shop must not hold up the rest. */
const SHOP_TIMEOUT_MS = 5_000;
const DEFAULT_CURRENCY = process.env.MARKETPLACE_DEFAULT_CURRENCY || 'UGX';

/** A listing from piitrade.com as shown on a result card in the video feed. */
export interface MarketplaceProduct {
  id: string;
  name: string;
  /** Display price, e.g. "UGX 800,000". */
  price: string;
  /** Display original price when the seller has reduced it, e.g. "UGX 900,000". */
  originalPrice?: string;
  image: string;
  description: string;
  /** Where to open this listing on piitrade.com. */
  listingUrl: string;
  location?: string;
  condition?: string;
  sellerName?: string;
  storeName?: string;
  verifiedSeller?: boolean;
  featured?: boolean;
  /** Which connected shop this listing is from (set by searchSites). */
  shop?: { id: string; name: string };
}

/**
 * One connected shop whose listing API can be searched (a row of Admin → Shops). Without a target every
 * function in this file behaves as it always did: it talks to the single MARKETPLACE_API marketplace.
 */
export interface ShopTarget {
  id: string;
  name: string;
  /** The shop's website origin; product links must be on this host. */
  baseUrl: string;
  /** The shop's listing API base (see docs/LISTING_SPEC.md). */
  apiBase: string;
  country: string;
  currency: string;
}

function baseUrl(target?: ShopTarget): string {
  const url = target ? target.apiBase : process.env.MARKETPLACE_API;
  if (!url) throw new HttpError(503, target ? `${target.name} has no listing API set` : 'Marketplace is not configured (set MARKETPLACE_API)');
  return url.replace(/\/+$/, '');
}

async function request(path: string, init: RequestInit, target?: ShopTarget): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), target ? SHOP_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
  const who = target ? target.name : 'Piitrade marketplace';
  try {
    // A registered shop's API base is admin-entered, so redirects are refused (they could lead to an internal host).
    return await fetch(`${baseUrl(target)}${path}`, { ...init, ...(target ? { redirect: 'error' as const } : {}), signal: controller.signal });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new HttpError(504, `${who} timed out`);
    }
    throw new HttpError(502, `Could not reach ${who}`);
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
export function resolveMarketplaceImageUrl(raw: string | null | undefined, target?: ShopTarget): string {
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  const base = baseUrl(target);
  return `${base}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

/** "UGX 800,000" — the same "<CURRENCY> <grouped number>" form piitrade.com itself shows. */
export function formatPrice(price: unknown, currency?: string | null): string {
  const value = typeof price === 'number' ? price : Number(price);
  const code = (currency || DEFAULT_CURRENCY).toUpperCase();
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
  /** Optional absolute product page URL (on the shop's own host). Default: {baseUrl}/listings/{id}. */
  url?: unknown;
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

/** UTM tags so a shop's own analytics can attribute visits that came from a video. */
function withUtm(raw: string): string {
  const u = new URL(raw);
  u.searchParams.set('utm_source', 'piitrade_videos');
  u.searchParams.set('utm_medium', 'video');
  return u.toString();
}

/**
 * Where a result opens. A registered shop may supply its own `url`, but only if it is on the shop's
 * registered host (a listing can't send viewers somewhere else); otherwise {baseUrl}/listings/{id}.
 */
export function shopListingUrl(target: ShopTarget, id: string, explicit?: unknown): string {
  if (typeof explicit === 'string' && hostMatchesSite(explicit, target.baseUrl)) {
    try {
      return withUtm(explicit);
    } catch {
      // fall through to the default
    }
  }
  return withUtm(`${target.baseUrl.replace(/\/+$/, '')}/listings/${encodeURIComponent(id)}`);
}

function toResult(l: RawListing, target?: ShopTarget): MarketplaceProduct {
  const originalPrice = firstNumber(l.originalPrice, l.compareAtPrice);
  const condition = firstString(l.condition);
  return {
    // Two shops can both have a listing "1", so a shop's results are namespaced (the apps use the id as a list key).
    id: target ? `${target.id}:${l.id}` : String(l.id),
    name: l.title,
    price: formatPrice(l.price, l.currency || target?.currency),
    originalPrice: originalPrice !== undefined && originalPrice > l.price ? formatPrice(originalPrice, l.currency || target?.currency) : undefined,
    image: resolveMarketplaceImageUrl(l.productImages?.find((img) => img.cdnUrl)?.cdnUrl || l.images?.[0], target),
    description: l.description || '',
    listingUrl: target ? shopListingUrl(target, String(l.id), l.url) : listingUrl(l.id),
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
  /** Opens this listing (or, for the local demo catalog, a piitrade.com search) on piitrade.com. */
  listingUrl: string;
  location?: string;
  condition?: string;
  sellerName?: string;
  storeName?: string;
  verifiedSeller?: boolean;
  featured?: boolean;
  /** Which connected shop the listing is from; absent for the single-marketplace and demo-catalog paths. */
  shop?: { id: string; name: string };
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
    location: p.location,
    condition: p.condition,
    sellerName: p.sellerName,
    storeName: p.storeName,
    verifiedSeller: p.verifiedSeller,
    featured: p.featured,
    shop: p.shop,
  };
}

/** Link to the full result set for `query` on piitrade.com ("See all on Piitrade"). */
export function browseUrlFor(query: string): string {
  return searchUrl(query);
}

export async function searchProducts(query: string, target?: ShopTarget): Promise<MarketplaceProduct[]> {
  const params = new URLSearchParams({ q: query, sort: 'relevance', limit: '12' });
  const country = target ? target.country : process.env.MARKETPLACE_COUNTRY;
  if (country) params.set('country', country);
  const path = `/api/listings?${params.toString()}`;
  const tag = target ? `[Marketplace:${target.name}]` : '[Marketplace]';
  console.log(`${tag} GET ${path}`);
  const startedAt = Date.now();

  const res = await request(
    path,
    {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    },
    target
  );
  console.log(`[Marketplace] responded ${res.status} in ${Date.now() - startedAt}ms`);

  if (!res.ok) {
    const message = (await readError(res)) || `Marketplace search returned ${res.status}`;
    console.error(`[Marketplace] search failed: ${message}`);
    throw new HttpError(res.status === 401 || res.status === 403 ? res.status : 502, message);
  }

  const data = (await res.json().catch(() => null)) as { listings?: RawListing[] } | null;
  // Other shops' APIs are not trusted to be well-formed: cap what is read and drop anything unusable.
  const listings = (Array.isArray(data?.listings) ? data!.listings! : []).slice(0, 24).filter((l) => l && typeof l === 'object' && l.id !== undefined && l.id !== null && typeof l.title === 'string');

  // A sold/expired/removed ad is a dead end for someone who just
  // watched a video of it — only surface listings that are live. A
  // listing with no status field at all is assumed live (the search
  // endpoint is itself expected to return active ads).
  const live = listings.filter((l) => !l.status || l.status === 'ACTIVE');
  const results = live.map((l) => {
    const r = toResult(l, target);
    return target ? { ...r, shop: { id: target.id, name: target.name } } : r;
  });

  console.log(
    `[Marketplace] ${results.length} live listing(s) for "${query}"` +
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

export async function searchProductsWithFallback(rawQuery: string, target?: ShopTarget, opts?: { deadline?: number }): Promise<MarketplaceSearchOutcome> {
  // Every shop gets the full ladder (a shorter one misses real matches — see above), but when many shops
  // are searched at once each one also has a deadline, so a slow shop can't hold the whole search up.
  const ladder = buildQueryLadder(rawQuery);
  const attempts: Array<{ query: string; count: number }> = [];

  for (const candidate of ladder) {
    if (opts?.deadline !== undefined && attempts.length > 0 && Date.now() > opts.deadline) {
      console.log(`[Marketplace] ${target?.name ?? 'marketplace'}: stopped trying shorter queries (time budget used up)`);
      break;
    }
    const results = await searchProducts(candidate, target);
    attempts.push({ query: candidate, count: results.length });
    if (results.length > 0) {
      if (candidate !== ladder[0]) {
        console.log(`[Marketplace] fallback: no match on full text "${ladder[0]}", matched on shortened query "${candidate}"`);
      }
      return { results, matchedQuery: candidate, attempts };
    }
  }

  console.log(
    `[Marketplace] no results for "${rawQuery}" after trying ${attempts.length} quer${attempts.length === 1 ? 'y' : 'ies'}: ` +
      attempts.map((a) => `"${a.query}"`).join(', ')
  );
  return { results: [], matchedQuery: null, attempts };
}
