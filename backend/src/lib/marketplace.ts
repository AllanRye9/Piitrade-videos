import { HttpError } from './httpError';

/**
 * Client for the real Piitrade marketplace backend (the actual
 * marketplace codebase, not a hypothetical one), reached via the
 * MARKETPLACE_API env var (its base URL, no trailing slash — e.g.
 * https://api.piitrade.com, no /api suffix, that's added per-call
 * below to match the marketplace's own route mounting).
 *
 * Endpoints used (see the marketplace repo's backend/src/routes/):
 *
 *   GET  /api/listings?q=<text>&limit=12&sort=relevance
 *     -> 200 { listings: Listing[], pagination: {...} }
 *     (routes/listings.ts — public, no auth)
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

export async function searchProducts(query: string): Promise<MarketplaceProduct[]> {
  const path = `/api/listings?q=${encodeURIComponent(query)}&limit=12&sort=relevance`;
  console.log(`[MARKETPLACE_API] GET ${path} (query="${query}")`);
  const startedAt = Date.now();

  const res = await request(path, {
    method: 'GET',
    headers: jsonHeaders(),
  });
  console.log(`[MARKETPLACE_API] responded ${res.status} in ${Date.now() - startedAt}ms`);

  if (!res.ok) {
    const message = (await readError(res)) || `Marketplace search returned ${res.status}`;
    console.error(`[MARKETPLACE_API] search failed: ${message}`);
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
    console.warn(`[MARKETPLACE_API] skipping ${withoutSeller} of ${listings.length} listing(s) with no resolvable seller`);
  }

  const results = listings
    .filter((l) => l.user?.id) // a listing without a resolvable seller can't be checked out — skip rather than crash
    .map((l) => ({
      id: l.id,
      name: l.title,
      price: l.currency ? `${l.price} ${l.currency}` : String(l.price),
      currency: l.currency,
      image: l.productImages?.find((img) => img.cdnUrl)?.cdnUrl || l.images?.[0] || '',
      description: l.description,
      inStock: l.status ? l.status === 'ACTIVE' && (l.stock ?? 1) > 0 : (l.stock ?? 1) > 0,
      sellerId: l.user!.id,
    }));

  console.log(
    `[MARKETPLACE_API] ${results.length} usable listing(s) for "${query}"` +
      (results.length > 0 ? `: ${results.slice(0, 5).map((r) => `"${r.name}" (${r.id})`).join(', ')}${results.length > 5 ? ', …' : ''}` : '')
  );
  return results;
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
