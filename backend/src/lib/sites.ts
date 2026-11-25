import crypto from 'crypto';
import { prisma } from '../db';
import { siteUrl } from './piitrade';
import { validateListingsResponse, type SpecIssue } from './listingSpec';

export function newPostbackSecret(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/**
 * Hostnames an admin-entered API base may not point at (the server would be calling it, so this
 * keeps "Test connection" from being used to probe the internal network).
 */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return false;
  if (/^\[?::1\]?$/.test(h) || /^\[?(fc|fd|fe80)/.test(h)) return false;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  return true;
}

/** First-run convenience: if no shop is registered, register piitrade.com so existing behaviour keeps working. */
export async function ensureDefaultSite(): Promise<void> {
  if ((await prisma.site.count()) > 0) return;
  await prisma.site.create({
    data: {
      name: 'Piitrade',
      slug: 'piitrade',
      baseUrl: siteUrl(),
      apiBase: (process.env.MARKETPLACE_API || '').replace(/\/+$/, ''),
      apiType: 'piitrade',
      country: process.env.MARKETPLACE_COUNTRY || '',
      currency: process.env.MARKETPLACE_DEFAULT_CURRENCY || 'UGX',
      commissionPct: Number(process.env.DEFAULT_COMMISSION_PCT) || 0,
      postbackSecret: newPostbackSecret(),
    },
  });
  console.log('Registered the default shop "Piitrade" (set its commission and postback secret in Admin → Shops).');
}

export interface ListingApiCheck {
  ok: boolean;
  status?: number;
  ms: number;
  issues: SpecIssue[];
  sampleCount?: number;
}

/**
 * Calls a shop's listing API (GET {apiBase}/api/listings?...) and validates the answer against the open
 * listing spec (docs/LISTING_SPEC.md). Used by Admin → Shops "Test connection" and to verify partner
 * applications. The URL must be public http(s) and redirects are refused, so this can't probe the internal network.
 */
export async function checkListingApi(apiBase: string, country = ''): Promise<ListingApiCheck> {
  const started = Date.now();
  if (!apiBase) return { ok: false, ms: 0, issues: [{ level: 'error', message: 'No API base set' }] };
  if (!isPublicHttpUrl(apiBase)) return { ok: false, ms: 0, issues: [{ level: 'error', message: 'API base must be a public http(s) URL' }] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const r = await fetch(`${apiBase}/api/listings?q=a&sort=relevance&limit=3${country ? `&country=${encodeURIComponent(country)}` : ''}`, { signal: controller.signal, redirect: 'error' });
    const ms = Date.now() - started;
    if (!r.ok) return { ok: false, status: r.status, ms, issues: [{ level: 'error', message: `The listing endpoint answered HTTP ${r.status}` }] };
    let body: unknown;
    try {
      body = await r.json();
    } catch {
      return { ok: false, status: r.status, ms, issues: [{ level: 'error', message: 'The response was not valid JSON (is this the API host rather than the website?)' }] };
    }
    return { status: r.status, ms, ...validateListingsResponse(body) };
  } catch (err: any) {
    return { ok: false, ms: Date.now() - started, issues: [{ level: 'error', message: err?.name === 'AbortError' ? 'Timed out after 10 seconds' : `Could not reach the API: ${err?.message || err}` }] };
  } finally {
    clearTimeout(timer);
  }
}

/** Hostname without a leading "www." — the identity of a shop for duplicate checks. */
export function hostOfUrl(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** A slug nobody has used yet: "acme", then "acme-2", "acme-3"… */
export async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || 'partner';
  for (let i = 1; i < 50; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`.slice(0, 44);
    if (!(await prisma.site.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
  }
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}
