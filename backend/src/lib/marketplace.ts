import { HttpError } from './httpError';

/**
 * Client for the external marketplace configured via the MARKETPLACE_API
 * env var (its base URL, no trailing slash). This file is the ONE place
 * that encodes the marketplace's API contract — if the real marketplace
 * uses different paths/payloads than assumed below, this is the only
 * file that needs to change; every route that calls it stays the same.
 *
 * Assumed contract (adjust to match the real marketplace if different):
 *
 *   GET  {MARKETPLACE_API}/products/search?q=<text>
 *     -> 200 { "products": MarketplaceProduct[] }
 *
 *   POST {MARKETPLACE_API}/auth/login      { email, password }
 *   POST {MARKETPLACE_API}/auth/register   { email, password, name? }
 *     -> 200 { "token": string, "userId": string }
 *
 *   POST {MARKETPLACE_API}/checkout        (Authorization: Bearer <token>)
 *     { "items": [{ "productId": string, "quantity": number }] }
 *     -> 200 { "orderId": string, "status": string, "redirectUrl"?: string }
 *
 * An optional MARKETPLACE_API_KEY (a server-to-server key, distinct from
 * a per-viewer login token) is sent as X-Api-Key on every request if set.
 */

const REQUEST_TIMEOUT_MS = 15_000;

export interface MarketplaceProduct {
  id: string;
  name: string;
  price: string;
  currency?: string;
  image: string;
  description: string;
  url?: string;
  inStock?: boolean;
}

export interface MarketplaceAuthResult {
  token: string;
  userId: string;
}

export interface MarketplaceCheckoutItem {
  productId: string;
  quantity: number;
}

export interface MarketplaceCheckoutResult {
  orderId: string;
  status: string;
  redirectUrl?: string;
}

function baseUrl(): string {
  const url = process.env.MARKETPLACE_API;
  if (!url) throw new HttpError(503, 'Marketplace is not configured (set MARKETPLACE_API)');
  return url.replace(/\/+$/, '');
}

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.MARKETPLACE_API_KEY) h['X-Api-Key'] = process.env.MARKETPLACE_API_KEY;
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new HttpError(504, 'Marketplace service timed out');
    }
    throw new HttpError(502, 'Could not reach the marketplace service');
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    // Preserve 401/403 so the frontend can distinguish "not logged in"
    // from a generic marketplace outage.
    const status = res.status === 401 || res.status === 403 ? res.status : 502;
    throw new HttpError(status, body?.error || `Marketplace service returned ${res.status}`);
  }

  return (await res.json()) as T;
}

export async function searchProducts(query: string): Promise<MarketplaceProduct[]> {
  const data = await call<{ products?: MarketplaceProduct[] }>(`/products/search?q=${encodeURIComponent(query)}`, {
    method: 'GET',
    headers: headers(),
  });
  return Array.isArray(data.products) ? data.products : [];
}

export async function login(email: string, password: string): Promise<MarketplaceAuthResult> {
  return call<MarketplaceAuthResult>('/auth/login', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email, password }),
  });
}

export async function register(email: string, password: string, name?: string): Promise<MarketplaceAuthResult> {
  return call<MarketplaceAuthResult>('/auth/register', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email, password, name }),
  });
}

export async function checkout(
  token: string,
  items: MarketplaceCheckoutItem[]
): Promise<MarketplaceCheckoutResult> {
  return call<MarketplaceCheckoutResult>('/checkout', {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ items }),
  });
}
