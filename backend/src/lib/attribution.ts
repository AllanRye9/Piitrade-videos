/**
 * Pure helpers for click attribution and the creator earnings ledger (no DB,
 * no network) — unit-tested in test/attribution.test.js. The DB-facing routes
 * live in routes/attribution.ts.
 *
 * Flow: a viewer taps Shop → GET /go/:videoId/:productId logs a Click and sends
 * them to the shop with ?pv_click=<token>. When that visitor buys, the shop's
 * server calls POST /api/attribution/conversion (signed with the site's
 * postback secret) with the token; that creates a Conversion, which is the
 * creator's ledger entry (commission = site.commissionPct of the sale).
 */
import crypto from 'crypto';

export const CLICK_PARAM = 'pv_click';
/** How long after a click a sale is still credited to the video. */
export const ATTRIBUTION_WINDOW_DAYS = 30;
/** Repeat taps on the same product by the same viewer inside this window reuse one click. */
export const CLICK_DEDUPE_MS = 60_000;
export const CONVERSION_STATUSES = ['pending', 'approved', 'paid', 'reversed'] as const;
export type ConversionStatus = (typeof CONVERSION_STATUSES)[number];

export function generateClickToken(): string {
  return crypto.randomBytes(18).toString('base64url');
}

/** Adds utm_* and the click token to a shop URL, never overriding params the link already has. */
export function buildRedirectUrl(productUrl: string, token: string, videoId: string, utmSource: string): string {
  const url = new URL(productUrl);
  const set = (k: string, v: string) => {
    if (!url.searchParams.has(k)) url.searchParams.set(k, v);
  };
  set('utm_source', utmSource);
  set('utm_medium', 'video');
  set('utm_campaign', `video-${videoId}`);
  url.searchParams.set(CLICK_PARAM, token);
  return url.toString();
}

/** One-way, daily-rotating viewer fingerprint: lets us de-duplicate taps without storing an IP. */
export function viewerHash(ip: string, userAgent: string, secret: string, now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return crypto.createHmac('sha256', secret).update(`${day}|${ip}|${userAgent}`).digest('hex').slice(0, 24);
}

export function signBody(secret: string, raw: Buffer | string): string {
  return crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

/** Accepts "sha256=<hex>" or bare hex. Constant-time; false for anything malformed. */
export function verifySignature(secret: string, raw: Buffer | string, header: string | undefined): boolean {
  if (!secret || !header) return false;
  const given = header.trim().replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = signBody(secret, raw);
  return crypto.timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
}

/** Sale amount (e.g. 12.5 or "12.50") → whole minor units (cents). null if not a sane, non-negative amount. */
export function toMinor(amount: unknown): number | null {
  const n = typeof amount === 'string' ? Number(amount.trim()) : typeof amount === 'number' ? amount : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return null;
  return Math.round(n * 100);
}

export function commissionFor(amountMinor: number, pct: number | undefined | null): number {
  const p = Number(pct);
  if (!Number.isFinite(p) || p <= 0) return 0;
  return Math.round((amountMinor * Math.min(100, p)) / 100);
}

const NEXT: Record<ConversionStatus, ConversionStatus[]> = {
  pending: ['approved', 'reversed'],
  approved: ['paid', 'reversed'],
  paid: [], // money has left; handle clawbacks outside the app
  reversed: [],
};

export function canTransition(from: string, to: string): boolean {
  return (NEXT[from as ConversionStatus] ?? []).includes(to as ConversionStatus);
}

export function isConversionStatus(v: unknown): v is ConversionStatus {
  return typeof v === 'string' && (CONVERSION_STATUSES as readonly string[]).includes(v);
}

export function validCurrency(v: unknown): string | null {
  const c = String(v ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : c === '' ? '' : null;
}

/** Totals of ledger rows per currency: { UGX: { pending, approved, paid } } in minor units. */
export function sumByCurrency(rows: Array<{ currency: string; status: string; commissionMinor: number }>): Record<string, { pending: number; approved: number; paid: number }> {
  const out: Record<string, { pending: number; approved: number; paid: number }> = {};
  for (const r of rows) {
    if (r.status !== 'pending' && r.status !== 'approved' && r.status !== 'paid') continue; // reversed earns nothing
    const key = r.currency || '—';
    (out[key] ??= { pending: 0, approved: 0, paid: 0 })[r.status] += r.commissionMinor;
  }
  return out;
}
