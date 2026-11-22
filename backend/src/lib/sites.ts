import crypto from 'crypto';
import { prisma } from '../db';
import { siteUrl } from './piitrade';

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
