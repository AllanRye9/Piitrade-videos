import crypto from 'crypto';

/** Query params that identify a visit rather than a page — dropped when comparing product URLs. */
const TRACKING_PARAMS = /^(utm_[a-z]+|pv_click|fbclid|gclid|ref)$/i;

/** Canonical form of a product URL (host lower-cased, no www/hash/tracking params/trailing slash), or null if not http(s). */
export function normalizeProductUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.replace(/\/+$/, '') || '';
  const qs = u.searchParams.toString();
  return `${host}${path}${qs ? `?${qs}` : ''}`;
}

/** True when `url` is on the shop's host (or one of its subdomains). Prevents the redirect being used against arbitrary sites. */
export function hostMatchesSite(url: string, siteBaseUrl: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const base = new URL(siteBaseUrl).hostname.toLowerCase().replace(/^www\./, '');
    return h === base || h.endsWith(`.${base}`);
  } catch {
    return false;
  }
}

export function newClickToken(): string {
  return crypto.randomBytes(18).toString('base64url');
}

const SALT = () => process.env.ATTRIBUTION_SALT || process.env.JWT_SECRET || 'dev-attribution-salt';

/** One-way, salted identifier — stored instead of raw session ids / IP addresses. */
export function hashId(value: string): string {
  return crypto.createHash('sha256').update(`${SALT()}:${value}`).digest('hex').slice(0, 32);
}

/** The destination URL with attribution parameters added (utm + the click token the shop echoes back). */
export function withClickParams(url: string, p: { token: string; videoId: string }): string {
  const u = new URL(url);
  u.searchParams.set('utm_source', 'piitrade_videos');
  u.searchParams.set('utm_medium', 'video');
  u.searchParams.set('utm_campaign', p.videoId);
  u.searchParams.set('pv_click', p.token);
  return u.toString();
}

// ---------- signed conversion postbacks ----------
export const POSTBACK_MAX_SKEW_MS = 5 * 60 * 1000;

/** hex HMAC-SHA256 over "<timestamp>.<raw body>" — the timestamp is signed so a captured request can't be replayed later. */
export function signPostback(secret: string, timestamp: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function verifyPostback(secret: string, timestamp: string, rawBody: string, signature: string, now = Date.now()): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > POSTBACK_MAX_SKEW_MS) return false;
  const given = Buffer.from(signature.replace(/^sha256=/i, '').trim(), 'hex');
  const expected = Buffer.from(signPostback(secret, timestamp, rawBody), 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export interface ConversionInput {
  clickToken: string;
  orderId: string;
  amount: unknown;
  currency: string;
}

export function parseConversion(body: any): ConversionInput | { error: string } {
  const clickToken = String(body?.clickToken ?? '').trim();
  const orderId = String(body?.orderId ?? '').trim();
  const currency = String(body?.currency ?? '').trim().toUpperCase();
  if (!clickToken || clickToken.length > 100) return { error: 'clickToken is required' };
  if (!orderId || orderId.length > 120) return { error: 'orderId is required' };
  if (!/^[A-Z]{3}$/.test(currency)) return { error: 'currency must be a 3-letter ISO code' };
  return { clickToken, orderId, amount: body?.amount, currency };
}

/** Clicks older than this can no longer earn a commission. */
export const ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export const PAYOUT_STATUSES = ['pending', 'approved', 'paid', 'reversed'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** Allowed status moves — keeps the ledger auditable (a paid entry can only be reversed, never silently reset). */
const NEXT: Record<PayoutStatus, PayoutStatus[]> = {
  pending: ['approved', 'reversed'],
  approved: ['paid', 'reversed', 'pending'],
  paid: ['reversed'],
  reversed: [],
};
export function canTransition(from: string, to: string): boolean {
  return (NEXT as Record<string, string[]>)[from]?.includes(to) ?? false;
}
