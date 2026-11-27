import crypto from 'crypto';
import { HttpError } from '../core/httpError';
import { hostOfUrl, isPublicHttpUrl } from './sites';

export interface CleanApplication {
  name: string;
  baseUrl: string;
  host: string;
  apiBase: string;
  country: string;
  currency: string;
  contactName: string;
  contactEmail: string;
  notes: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Validates and normalises the public application form. Throws a 400 HttpError naming the first problem. */
export function cleanApplication(body: any): CleanApplication {
  const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
  const name = str(body?.name, 80);
  if (!name) throw new HttpError(400, 'Your shop or app name is required');

  const baseUrl = str(body?.baseUrl, 300).replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/i.test(baseUrl) || !isPublicHttpUrl(baseUrl)) {
    throw new HttpError(400, 'Website must be a public http(s) URL, e.g. https://shop.example.com');
  }
  const apiBase = str(body?.apiBase, 300).replace(/\/+$/, '');
  if (!apiBase) throw new HttpError(400, 'Your listing API base URL is required — it is how Piitrade Videos connects to you');
  if (!/^https?:\/\/[^\s/]+/i.test(apiBase) || !isPublicHttpUrl(apiBase)) {
    throw new HttpError(400, 'API base must be a public http(s) URL, e.g. https://api.shop.example.com');
  }
  const contactEmail = str(body?.contactEmail, 200).toLowerCase();
  if (!EMAIL.test(contactEmail)) throw new HttpError(400, 'A valid contact email is required');

  const country = str(body?.country, 20).toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) throw new HttpError(400, 'Country must be a 2-letter ISO code, e.g. UG');
  const currency = str(body?.currency, 20).toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'Currency must be a 3-letter ISO code, e.g. UGX');

  return {
    name,
    baseUrl,
    host: hostOfUrl(baseUrl),
    apiBase,
    country,
    currency,
    contactName: str(body?.contactName, 80),
    contactEmail,
    notes: str(body?.notes, 1000),
  };
}

/** A random status token (shown to the applicant once) and the hash that is stored. */
export function newApplicationToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(24).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function tokenMatches(token: unknown, hash: string): boolean {
  if (typeof token !== 'string' || !token) return false;
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
