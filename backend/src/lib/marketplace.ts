import { HttpError } from './httpError';

/**
 * Client for the real Piitrade marketplace's backend API. Set
 * MARKETPLACE_API to that backend's own base URL — NOT the
 * piitrade.com frontend's URL. Confirmed directly by inspecting what
 * piitrade.com's Next.js frontend itself calls: its listing images
 * are served from a separate Railway-hosted backend
 * (https://backend-production-a662.up.railway.app/api/images/...),
 * and https://piitrade.com/listings itself returns the full rendered
 * HTML marketing/browse page, NOT JSON — pointing MARKETPLACE_API at
 * piitrade.com directly will fail every search with a JSON-parse
 * error. Point it at the backend host instead, e.g.
 * https://backend-production-a662.up.railway.app (confirm the exact
 * current backend URL, since Railway hostnames can change on
 * redeploy — see .env.example).
 *
 * Endpoints used:
 *
 *   GET  /api/listings?q=<text>&sort=relevance&limit=12&country=<COUNTRY>
 *     -> 200 { listings: Listing[], pagination: {...} }
 *     Confirmed directly against this route's source
 *     (backend/src/routes/listings.ts): q, sort, limit, and country
 *     are all real supported query params on this exact path.
 *     `country` is sent only when MARKETPLACE_COUNTRY is set.
 *
 *   POST /api/auth/register   { email, password, name, country }
 *     -> 201 { message, user }   -- NOTE: no tokens. The marketplace
 *        requires email verification before login (except ADMIN
 *        accounts), so registering does NOT immediately produce a
 *        usable session — see registerAccount()'s return type.
 *
 *   POST /api/auth/login      { email, password }
 *     -> 200 { user, accessToken }, plus a Set-Cookie: refreshToken=...
 *        (httpOnly, scoped to /api/auth). Since this is a
 *        server-to-server call (not a browser), the refresh token is
 *        extracted from that Set-Cookie header by hand and stored
 *        alongside the access token — see extractRefreshToken().
 *
 *   POST /api/auth/refresh    (Cookie: refreshToken=<token>)
 *     -> 200 { accessToken }, plus a rotated Set-Cookie: refreshToken=...
 *        Access tokens expire in ~1h (JWT_EXPIRES_IN); this is used to
 *        get a fresh one without asking the viewer to log in again.
 *
 *   POST /api/orders          (Authorization: Bearer <accessToken>)
 *     { items: [{ listingId, quantity }] }
 *     -> 201 { order }
 *     IMPORTANT business rule enforced by the marketplace itself: every
 *     item in one order must belong to the same seller. Callers of
 *     checkout() must already have grouped items by seller — see
 *     routes/marketplace.ts, which does this grouping and calls
 *     checkout() once per seller.
 *
 * Error responses from this backend use `{ message: string }` (not
 * `{ error }`) — see its errorHandler.ts.
 */

const REQUEST_TIMEOUT_MS = 15_000;
const REFRESH_COOKIE_NAME = 'refreshToken';
const VALID_COUNTRIES = ['UAE', 'UGANDA', 'KENYA', 'CHINA'] as const;
export type MarketplaceCountry = (typeof VALID_COUNTRIES)[number];

export function isValidMarketplaceCountry(value: unknown): value is MarketplaceCountry {
  return typeof value === 'string' && (VALID_COUNTRIES as readonly string[]).includes(value);
}

export interface MarketplaceProduct {
  id: string;
  name: string;
  price: string;
  currency?: string;
  image: string;
  description: string;
  url?: string;
  inStock?: boolean;
  /** The listing's seller (Listing.userId) — required to group cart items into
   *  same-seller orders at checkout time (see the business rule above). */
  sellerId: string;
}

export interface MarketplaceAuthResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

/** Result of a registration attempt — never includes tokens (see above). */
export interface MarketplaceRegistrationResult {
  message: string;
}

export interface MarketplaceCheckoutItem {
  productId: string; // maps to the marketplace's listingId
  quantity: number;
}

export interface MarketplaceCheckoutResult {
  orderId: string;
  orderNumber?: string;
  status: string;
  redirectUrl?: string;
}

function baseUrl(): string {
  const url = process.env.MARKETPLACE_API;
  if (!url) throw new HttpError(503, 'Marketplace is not configured (set MARKETPLACE_API)');
  return url.replace(/\/+$/, '');
}

function jsonHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

/**
 * Node's fetch (undici) exposes multiple Set-Cookie headers via
 * `headers.getSetCookie()` on Node 18.15+/20+. That's relied on here
 * rather than `headers.get('set-cookie')`, which — per the Fetch spec
 * — combines multiple Set-Cookie headers into one comma-joined string
 * that can't be reliably split back apart (cookie attributes like
 * `Expires=Wed, 09 Jun 2027...` themselves contain commas).
 */
function extractRefreshToken(res: Response): string | null {
  const headers = res.headers as Response['headers'] & { getSetCookie?: () => string[] };
  const rawCookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  for (const raw of rawCookies) {
    const match = raw.match(new RegExp(`^${REFRESH_COOKIE_NAME}=([^;]+)`));
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
  }
  return null;
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${baseUrl()}${path}`, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new HttpError(504, 'Marketplace service timed out');
    }
    throw new HttpError(502, 'Could not reach the marketplace service');
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
 * `productImages[].cdnUrl` is confirmed to already be an absolute URL
 * (see the file-level comment above). The legacy `images[0]` fallback
 * is NOT — it's a path relative to the marketplace's OWN backend
 * (MARKETPLACE_API), not to this app's backend. Left unresolved, the
 * frontend's mediaUrl() would prefix it with this app's own API_BASE
 * instead, pointing at the wrong host entirely and rendering as a
 * broken image on every listing that falls into that fallback. This
 * is the one place that decides what ends up in a listing's `image`
 * field, so every caller (search, manual search) gets a URL that
 * actually loads.
 */
function resolveMarketplaceImageUrl(raw: string | null | undefined): string {
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  const base = baseUrl();
  return `${base}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

export interface MarketplaceSearchResultDto {
  id: string;
  name: string;
  price: string;
  category: string;
  image: string;
  description?: string;
  productUrl?: string;
  inStock?: boolean;
  sellerId?: string;
  match: number;
}

/** Shared shape mapper used by every route that turns a MarketplaceProduct
 *  into what SearchResultsPanel renders — factored out so visual search and
 *  manual text search can't drift into two different response shapes. */
export function toSearchResultDto(p: MarketplaceProduct, category: string): MarketplaceSearchResultDto {
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    category,
    image: p.image,
    description: p.description,
    productUrl: p.url,
    inStock: p.inStock ?? true,
    sellerId: p.sellerId,
    match: 100,
  };
}

export async function searchProducts(query: string): Promise<MarketplaceProduct[]> {
  const params = new URLSearchParams({ q: query, sort: 'relevance', limit: '12' });
  if (process.env.MARKETPLACE_COUNTRY) params.set('country', process.env.MARKETPLACE_COUNTRY);
  const path = `/api/listings?${params.toString()}`;
  console.log(`[Marketplace] GET ${path}`);
  const startedAt = Date.now();

  const res = await request(path, {
    method: 'GET',
    headers: jsonHeaders(),
  });
  console.log(`[Marketplace] responded ${res.status} in ${Date.now() - startedAt}ms`);

  if (!res.ok) {
    const message = (await readError(res)) || `Marketplace search returned ${res.status}`;
    console.error(`[Marketplace] search failed: ${message}`);
    throw new HttpError(res.status === 401 || res.status === 403 ? res.status : 502, message);
  }
  interface RawListing {
    id: string;
    title: string;
    description: string;
    price: number;
    currency?: string;
    stock?: number;
    status?: string;
    images?: string[];
    productImages?: Array<{ cdnUrl: string | null }>;
    user?: { id: string };
  }
  const data = (await res.json()) as { listings?: RawListing[] };
  const listings = Array.isArray(data.listings) ? data.listings : [];
  const withoutSeller = listings.filter((l) => !l.user?.id).length;
  if (withoutSeller > 0) {
    console.warn(`[Marketplace] skipping ${withoutSeller} of ${listings.length} listing(s) with no resolvable seller`);
  }

  const results = listings
    .filter((l) => l.user?.id) // a listing without a resolvable seller can't be checked out — skip rather than crash
    .map((l) => ({
      id: l.id,
      name: l.title,
      price: l.currency ? `${l.price} ${l.currency}` : String(l.price),
      currency: l.currency,
      image: resolveMarketplaceImageUrl(l.productImages?.find((img) => img.cdnUrl)?.cdnUrl || l.images?.[0]),
      description: l.description,
      inStock: l.status ? l.status === 'ACTIVE' && (l.stock ?? 1) > 0 : (l.stock ?? 1) > 0,
      sellerId: l.user!.id,
    }));

  console.log(
    `[Marketplace] ${results.length} usable listing(s) for "${query}"` +
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

export async function searchProductsWithFallback(rawQuery: string): Promise<MarketplaceSearchOutcome> {
  const ladder = buildQueryLadder(rawQuery);
  const attempts: Array<{ query: string; count: number }> = [];

  for (const candidate of ladder) {
    const results = await searchProducts(candidate);
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

export async function registerAccount(
  email: string,
  password: string,
  name: string,
  country: MarketplaceCountry
): Promise<MarketplaceRegistrationResult> {
  const res = await request('/api/auth/register', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password, name, country }),
  });
  if (!res.ok) {
    const status = res.status === 409 ? 409 : res.status === 400 ? 400 : 502;
    throw new HttpError(status, (await readError(res)) || `Registration failed (${res.status})`);
  }
  const data = (await res.json()) as { message?: string };
  return { message: data.message || 'Registration successful. Please verify your email before logging in.' };
}

export async function login(email: string, password: string): Promise<MarketplaceAuthResult> {
  const res = await request('/api/auth/login', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const status = res.status === 401 || res.status === 403 ? res.status : 502;
    throw new HttpError(status, (await readError(res)) || `Login failed (${res.status})`);
  }
  const data = (await res.json()) as { user?: { id: string }; accessToken?: string };
  const refreshToken = extractRefreshToken(res);
  if (!data.accessToken || !data.user?.id || !refreshToken) {
    throw new HttpError(502, 'Marketplace login response was missing required fields');
  }
  return { accessToken: data.accessToken, refreshToken, userId: data.user.id };
}

/** Exchanges a stored refresh token for a fresh access token (and a rotated refresh token). */
export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await request('/api/auth/refresh', {
    method: 'POST',
    headers: { Cookie: `${REFRESH_COOKIE_NAME}=${encodeURIComponent(refreshToken)}` },
  });
  if (!res.ok) {
    throw new HttpError(401, (await readError(res)) || 'Marketplace session expired — please log in again');
  }
  const data = (await res.json()) as { accessToken?: string };
  const newRefreshToken = extractRefreshToken(res);
  if (!data.accessToken || !newRefreshToken) {
    throw new HttpError(502, 'Marketplace refresh response was missing required fields');
  }
  return { accessToken: data.accessToken, refreshToken: newRefreshToken };
}

/**
 * Places one order for a single seller's items. Callers MUST have
 * already grouped items by seller (see routes/marketplace.ts) — the
 * marketplace itself rejects a mixed-seller order with a 400.
 */
export async function checkout(accessToken: string, items: MarketplaceCheckoutItem[]): Promise<MarketplaceCheckoutResult> {
  const res = await request('/api/orders', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ items: items.map((i) => ({ listingId: i.productId, quantity: i.quantity })) }),
  });
  if (!res.ok) {
    const status = res.status === 401 || res.status === 403 ? res.status : res.status === 400 ? 400 : 502;
    throw new HttpError(status, (await readError(res)) || `Checkout failed (${res.status})`);
  }
  const data = (await res.json()) as { order?: { id: string; orderNumber?: string; status?: string } };
  if (!data.order?.id) {
    throw new HttpError(502, 'Marketplace order response was missing required fields');
  }
  return { orderId: data.order.id, orderNumber: data.order.orderNumber, status: data.order.status || 'PENDING' };
}
