import { Router, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import crypto from 'crypto';
import { prisma } from '../db';
import { HttpError } from '../lib/httpError';
import { requireAccount } from '../middleware/requireAccount';
import { listSites } from '../lib/sites';
import { UTM_SOURCE } from '../lib/siteUrls';
import { ATTRIBUTION_WINDOW_DAYS, CLICK_DEDUPE_MS, buildRedirectUrl, commissionFor, generateClickToken, validCurrency, verifySignature, toMinor, viewerHash } from '../lib/attribution';
import { attributionStats, creatorEarnings } from '../lib/attributionStats';
import { getSessionId } from './videos';

/**
 * Mounted at the site root (not under /api) because /go/... is a link people
 * tap and share. See lib/attribution.ts for the flow.
 */
const router = Router();

const BOT_UA = /bot|crawler|spider|preview|facebookexternalhit|slurp|embedly|whatsapp|telegram|curl|wget/i;

function clientIp(req: Request): string {
  return (req.header('x-forwarded-for') || '').split(',')[0].trim() || req.ip || 'unknown';
}

// Per-IP budget for *logging* clicks. Over budget, the viewer is still sent to
// the shop — we just stop recording — so a script can't flood the table and a
// real person is never blocked from shopping.
const buckets = new Map<string, { n: number; reset: number }>();
const LOGS_PER_MINUTE = 60;
function mayLog(ip: string): boolean {
  const now = Date.now();
  if (buckets.size > 5000) buckets.clear();
  const b = buckets.get(ip);
  if (!b || b.reset < now) {
    buckets.set(ip, { n: 1, reset: now + 60_000 });
    return true;
  }
  b.n += 1;
  return b.n <= LOGS_PER_MINUTE;
}

const hashSecret = () => process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';

// GET /go/:videoId/:productId — log the tap, then send the viewer to the shop.
router.get('/go/:videoId/:productId', async (req: Request, res: Response) => {
  const { videoId, productId } = req.params;
  const product = await prisma.videoProduct.findFirst({
    where: { id: productId, videoId },
    include: { video: { select: { uploaderSessionId: true } } },
  });
  const site = product ? (await listSites()).find((s) => s.id === product.siteId && s.active) : null;
  res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'origin-when-cross-origin');
  if (!product || !site) {
    res.status(404).type('text/plain').send('This link is no longer available.');
    return;
  }

  const ua = req.header('user-agent') || '';
  const ip = clientIp(req);
  let token = generateClickToken();
  if (!BOT_UA.test(ua) && mayLog(ip)) {
    const vh = viewerHash(ip, ua, hashSecret());
    try {
      // A quick double-tap (or a reload) reuses the click instead of inflating the count.
      const recent = await prisma.click.findFirst({
        where: { viewerHash: vh, productId: product.id, createdAt: { gte: new Date(Date.now() - CLICK_DEDUPE_MS) } },
        select: { token: true },
      });
      if (recent) token = recent.token;
      else {
        await prisma.click.create({
          data: { token, videoId, productId: product.id, siteId: site.id, creatorSessionId: product.video?.uploaderSessionId ?? null, viewerHash: vh },
        });
      }
    } catch (err) {
      console.error('click log failed (redirecting anyway):', err instanceof Error ? err.message : err);
    }
  }
  res.redirect(302, buildRedirectUrl(product.url, token, videoId, UTM_SOURCE));
});

// POST /api/attribution/conversion — a shop reports a sale (server to server).
//   headers: X-Piitrade-Site: <site slug>, X-Piitrade-Signature: sha256=<hex HMAC-SHA256 of the raw body, keyed with the site's postback secret>
//   body:    { click: "<pv_click token>", orderId: "A-1001", amount: 49.99, currency: "USD" }
//            or { click, orderId, status: "reversed" } to cancel a sale that was refunded.
const postbackLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.ip ? ipKeyGenerator(req.ip) : 'unknown'),
  message: { error: 'Too many requests' },
});

async function siteForSignedRequest(req: Request) {
  const slug = String(req.header('x-piitrade-site') || '').trim();
  const site = slug ? (await prisma.site.findUnique({ where: { slug } })) : null;
  return site as { id: string; slug: string; currency: string; commissionPct: number; postbackSecret: string } | null;
}

router.post('/api/attribution/conversion', postbackLimiter, async (req: Request, res: Response) => {
  const site = await siteForSignedRequest(req);
  const raw: Buffer | undefined = (req as any).rawBody;
  // Same answer for "no such site" and "bad signature" so slugs can't be probed.
  if (!site || !raw || !verifySignature(site.postbackSecret, raw, req.header('x-piitrade-signature'))) {
    throw new HttpError(401, 'Invalid site or signature');
  }

  const token = String(req.body?.click ?? '').trim();
  const orderId = String(req.body?.orderId ?? '').trim().slice(0, 100);
  if (!token || !orderId) throw new HttpError(400, 'click and orderId are required');

  const click = await prisma.click.findUnique({ where: { token } });
  if (!click || click.siteId !== site.id) throw new HttpError(404, 'Unknown click');

  const existing = await prisma.conversion.findUnique({ where: { siteId_externalOrderId: { siteId: site.id, externalOrderId: orderId } } });

  if (req.body?.status === 'reversed') {
    if (!existing) throw new HttpError(404, 'Unknown order');
    if (existing.status === 'pending' || existing.status === 'approved') {
      await prisma.conversion.update({ where: { id: existing.id }, data: { status: 'reversed' } });
      res.json({ id: existing.id, status: 'reversed' });
    } else {
      res.json({ id: existing.id, status: existing.status, unchanged: true });
    }
    return;
  }

  if (existing) {
    res.json({ id: existing.id, status: existing.status, commissionMinor: existing.commissionMinor, duplicate: true });
    return;
  }
  if (Date.now() - click.createdAt.getTime() > ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    throw new HttpError(422, `That click is older than ${ATTRIBUTION_WINDOW_DAYS} days`, { code: 'CLICK_EXPIRED' });
  }
  const amountMinor = toMinor(req.body?.amount);
  if (amountMinor === null) throw new HttpError(400, 'amount must be a non-negative number');
  const currency = validCurrency(req.body?.currency);
  if (currency === null) throw new HttpError(400, 'currency must be a 3-letter code such as USD');

  try {
    const created = await prisma.conversion.create({
      data: {
        clickId: click.id,
        videoId: click.videoId,
        siteId: site.id,
        creatorSessionId: click.creatorSessionId,
        externalOrderId: orderId,
        amountMinor,
        currency: currency || site.currency || '',
        commissionMinor: commissionFor(amountMinor, site.commissionPct),
      },
    });
    res.status(201).json({ id: created.id, status: created.status, commissionMinor: created.commissionMinor });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      // Two identical postbacks raced: the other one won, which is fine.
      const again = await prisma.conversion.findUnique({ where: { siteId_externalOrderId: { siteId: site.id, externalOrderId: orderId } } });
      res.json({ id: again?.id, status: again?.status, duplicate: true });
      return;
    }
    throw err;
  }
});

// GET /api/attribution/report?days=30 — a shop's own numbers. Authorization: Bearer <postback secret>, X-Piitrade-Site: <slug>.
router.get('/api/attribution/report', postbackLimiter, async (req: Request, res: Response) => {
  const site = await siteForSignedRequest(req);
  const bearer = (req.header('authorization') || '').replace(/^Bearer\s+/i, '');
  const ok = !!site && !!site.postbackSecret && bearer.length === site.postbackSecret.length && crypto.timingSafeEqual(Buffer.from(bearer), Buffer.from(site.postbackSecret));
  if (!site || !ok) throw new HttpError(401, 'Invalid site or key');
  const days = Math.max(1, Math.min(365, Math.trunc(Number(req.query.days)) || 30));
  res.json(await attributionStats(site.id, new Date(Date.now() - days * 24 * 60 * 60 * 1000)));
});

// GET /api/earnings — the signed-in creator's ledger.
router.get('/api/earnings', requireAccount, async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const [earnings, sites] = await Promise.all([creatorEarnings(sessionId), listSites()]);
  res.json({ ...earnings, rates: sites.filter((s) => s.active && (s.commissionPct ?? 0) > 0).map((s) => ({ site: s.name, commissionPct: s.commissionPct })) });
});

export default router;
