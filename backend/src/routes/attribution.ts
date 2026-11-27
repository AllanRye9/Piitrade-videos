import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { HttpError } from '../lib/core/httpError';
import { requireAccount } from '../middleware/requireAccount';
import { getSessionId } from './videos';
import { postbackLimiter, redirectLimiter, writeLimiter } from '../middleware/rateLimit';
import {
  ATTRIBUTION_WINDOW_MS,
  hashId,
  hostMatchesSite,
  newClickToken,
  parseConversion,
  verifyPostback,
  withClickParams,
} from '../lib/shops/attribution';
import { commissionMinor, fromMinor, toMinor } from '../lib/core/money';

/** Clicks by the same viewer on the same link within this window reuse one click row (double-taps, link re-opens). */
const CLICK_DEDUPE_MS = 10_000;

interface Target {
  site: { id: string; baseUrl: string };
  url: string;
  productId: string | null;
}

/**
 * Works out where a tap should go. Either a pinned product (by id) or a raw URL (e.g. a search
 * result in "Find on Piitrade") — and in both cases the destination must be on a registered,
 * active shop, so this can never be used as an open redirect.
 */
async function resolveTarget(videoId: string, productId?: string, rawUrl?: string): Promise<Target> {
  if (productId) {
    const p = await prisma.videoProduct.findFirst({ where: { id: productId, videoId }, include: { site: true } });
    if (!p || !p.site.active) throw new HttpError(404, 'Product not found');
    return { site: p.site, url: p.url, productId: p.id };
  }
  if (!rawUrl) throw new HttpError(400, 'A product or url is required');
  const sites = await prisma.site.findMany({ where: { active: true } });
  const site = sites.find((s: { baseUrl: string }) => hostMatchesSite(rawUrl, s.baseUrl));
  if (!site) throw new HttpError(400, 'That link is not on a connected shop');
  return { site, url: rawUrl, productId: null };
}

/**
 * Logs the click and returns the final destination with attribution params. `viewerSessionId`
 * is set for in-app taps; anonymous web/embed taps are identified only by a hashed IP.
 */
export async function logClick(opts: { videoId: string; target: Target; viewerSessionId?: string; ip?: string }): Promise<{ url: string; token: string }> {
  const video = await prisma.video.findUnique({ where: { id: opts.videoId }, select: { id: true, uploaderSessionId: true } });
  if (!video) throw new HttpError(404, 'Video not found');

  const viewerHash = opts.viewerSessionId && opts.viewerSessionId !== 'anonymous' ? hashId(opts.viewerSessionId) : null;
  const ipHash = opts.ip ? hashId(opts.ip) : null;
  // Signed-in taps are de-duplicated per viewer; anonymous taps per IP *among anonymous clicks only*,
  // so a signed-in viewer and an anonymous visitor behind the same NAT are never merged into one click.
  const who = viewerHash ? { viewerHash } : ipHash ? { viewerHash: null, ipHash } : null;

  if (who) {
    const recent = await prisma.click.findFirst({
      where: { videoId: video.id, url: opts.target.url, ...who, createdAt: { gte: new Date(Date.now() - CLICK_DEDUPE_MS) } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) return { url: withClickParams(opts.target.url, { token: recent.token, videoId: video.id }), token: recent.token };
  }

  const token = newClickToken();
  await prisma.click.create({
    data: {
      token,
      videoId: video.id,
      siteId: opts.target.site.id,
      productId: opts.target.productId,
      creatorSessionId: video.uploaderSessionId,
      viewerHash,
      ipHash,
      url: opts.target.url,
    },
  });
  return { url: withClickParams(opts.target.url, { token, videoId: video.id }), token };
}

/** GET /go/:videoId/:productId?  (?url= for a non-pinned link) — public redirect used by embeds, widgets and the web. */
export async function goHandler(req: Request, res: Response) {
  const url = typeof req.query.url === 'string' ? req.query.url : undefined;
  const target = await resolveTarget(req.params.videoId, req.params.productId, url);
  const click = await logClick({ videoId: req.params.videoId, target, ip: req.ip });
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer-when-downgrade');
  res.redirect(302, click.url);
}

export const goRouter = Router();
goRouter.get('/go/:videoId/:productId', redirectLimiter, goHandler);
goRouter.get('/go/:videoId', redirectLimiter, goHandler);

const router = Router();

// POST /api/attribution/click  { videoId, productId? | url }
// The app uses this instead of opening /go in a browser: the session id travels in the header (it
// is a credential, so it must never be put in a URL) and the app opens the returned `url` itself.
router.post('/click', writeLimiter, async (req: Request, res: Response) => {
  const videoId = String(req.body?.videoId || '');
  const productId = req.body?.productId ? String(req.body.productId) : undefined;
  const url = req.body?.url ? String(req.body.url) : undefined;
  if (!videoId) throw new HttpError(400, 'videoId is required');
  const target = await resolveTarget(videoId, productId, url);
  const click = await logClick({ videoId, target, viewerSessionId: getSessionId(req), ip: req.ip });
  res.json({ url: click.url });
});

// POST /api/attribution/conversion — a shop reports a sale.
//
//   X-Piitrade-Site:      <site slug>
//   X-Piitrade-Timestamp: <unix ms>
//   X-Piitrade-Signature: hex HMAC-SHA256(site secret, "<timestamp>.<raw body>")
//   body: { clickToken, orderId, amount, currency }
//
// Idempotent on (site, orderId): replaying a postback returns 200 { duplicate: true } and changes nothing.
router.post('/conversion', postbackLimiter, async (req: Request, res: Response) => {
  const slug = String(req.header('x-piitrade-site') || '').trim();
  const timestamp = String(req.header('x-piitrade-timestamp') || '').trim();
  const signature = String(req.header('x-piitrade-signature') || '').trim();
  const raw: Buffer | undefined = (req as any).rawBody;
  if (!slug || !timestamp || !signature || !raw) throw new HttpError(400, 'Missing signature headers or body');

  const site = await prisma.site.findUnique({ where: { slug } });
  // Same error for "unknown site" and "bad signature" so slugs can't be enumerated.
  if (!site || !site.active || !verifyPostback(site.postbackSecret, timestamp, raw.toString('utf8'), signature)) {
    throw new HttpError(401, 'Invalid signature');
  }

  const parsed = parseConversion(req.body);
  if ('error' in parsed) throw new HttpError(400, parsed.error);
  const amountMinor = toMinor(parsed.amount);
  if (amountMinor === null) throw new HttpError(400, 'amount must be a positive number');

  const click = await prisma.click.findUnique({ where: { token: parsed.clickToken } });
  if (!click || click.siteId !== site.id) throw new HttpError(404, 'Unknown click token');
  if (Date.now() - click.createdAt.getTime() > ATTRIBUTION_WINDOW_MS) throw new HttpError(422, 'This click is outside the attribution window');

  // A creator buying through their own link earns nothing (the sale is still recorded).
  const selfReferral = !!click.creatorSessionId && !!click.viewerHash && click.viewerHash === hashId(click.creatorSessionId);
  const owed = selfReferral || !click.creatorSessionId ? BigInt(0) : commissionMinor(amountMinor, site.commissionPct);

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const conversion = await tx.conversion.create({
        data: { clickId: click.id, siteId: site.id, externalOrderId: parsed.orderId, amountMinor, currency: parsed.currency },
      });
      if (owed > BigInt(0) && click.creatorSessionId) {
        await tx.payoutEntry.create({
          data: { conversionId: conversion.id, creatorSessionId: click.creatorSessionId, amountMinor: owed, currency: parsed.currency },
        });
      }
      return conversion;
    });
    res.status(201).json({ ok: true, conversionId: result.id, credited: owed > BigInt(0), selfReferral });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }
    throw err;
  }
});

// GET /api/attribution/earnings — the signed-in creator's ledger.
router.get('/earnings', requireAccount, async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const [grouped, entries] = await Promise.all([
    prisma.payoutEntry.groupBy({ by: ['currency', 'status'], where: { creatorSessionId: sessionId }, _sum: { amountMinor: true } }),
    prisma.payoutEntry.findMany({
      where: { creatorSessionId: sessionId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { conversion: { select: { click: { select: { video: { select: { id: true, title: true } } } } } } },
    }),
  ]);

  const balances = new Map<string, { currency: string; pending: number; approved: number; paid: number }>();
  for (const g of grouped as any[]) {
    if (g.status === 'reversed') continue;
    const b = balances.get(g.currency) ?? { currency: g.currency, pending: 0, approved: 0, paid: 0 };
    if (g.status === 'pending' || g.status === 'approved' || g.status === 'paid') b[g.status as 'pending' | 'approved' | 'paid'] = fromMinor(g._sum.amountMinor ?? 0);
    balances.set(g.currency, b);
  }

  res.json({
    balances: [...balances.values()],
    entries: (entries as any[]).map((e) => ({
      id: e.id,
      amount: fromMinor(e.amountMinor),
      currency: e.currency,
      status: e.status,
      createdAt: e.createdAt,
      videoId: e.conversion?.click?.video?.id ?? null,
      videoTitle: e.conversion?.click?.video?.title ?? null,
    })),
  });
});

export default router;
