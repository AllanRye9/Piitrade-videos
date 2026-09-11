import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { HttpError } from '../lib/httpError';
import * as marketplace from '../lib/marketplace';
import { isValidMarketplaceCountry, MarketplaceCheckoutItem, MarketplaceCheckoutResult } from '../lib/marketplace';

const router = Router();

/**
 * Every route here is scoped to the anonymous browser session (the
 * same X-Session-Id header used by /api/videos for likes/favorites/
 * saves — see routes/videos.ts). A marketplace login is stored against
 * that session id, so "is this viewer already linked?" can be answered
 * without asking them to log in again on every video.
 */
function getSessionId(req: Request): string {
  const id = req.header('x-session-id');
  if (!id || !id.trim()) throw new HttpError(400, 'Missing X-Session-Id header');
  return id.trim();
}

async function saveLink(sessionId: string, accessToken: string, refreshToken: string, userId: string) {
  await prisma.marketplaceLink.upsert({
    where: { sessionId },
    update: { marketplaceToken: accessToken, marketplaceRefreshToken: refreshToken, marketplaceUserId: userId },
    create: { sessionId, marketplaceToken: accessToken, marketplaceRefreshToken: refreshToken, marketplaceUserId: userId },
  });
}

// GET /api/marketplace/account — is this session already linked to a marketplace account?
router.get('/account', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const link = await prisma.marketplaceLink.findUnique({ where: { sessionId } });
  res.json({ linked: Boolean(link) });
});

// POST /api/marketplace/login  { email, password }
router.post('/login', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    throw new HttpError(400, 'Email and password are required');
  }

  const result = await marketplace.login(email.trim(), password);
  await saveLink(sessionId, result.accessToken, result.refreshToken, result.userId);
  res.json({ linked: true });
});

// POST /api/marketplace/register  { email, password, name, country }
//
// NOTE: unlike a typical register-then-login flow, the marketplace
// requires email verification before its /auth/login will succeed
// (see lib/marketplace.ts) — so this does NOT link the session or
// return a usable session. The frontend must tell the viewer to check
// their email, then let them log in once verified.
router.post('/register', async (req: Request, res: Response) => {
  // No session-scoping needed here — registering doesn't write a
  // MarketplaceLink — but keep the header requirement consistent with
  // every other route in this file so a missing X-Session-Id fails
  // the same way everywhere.
  getSessionId(req);
  const { email, password, name, country } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    throw new HttpError(400, 'Email and password are required');
  }
  if (typeof name !== 'string' || !name.trim()) {
    throw new HttpError(400, 'Name is required');
  }
  if (!isValidMarketplaceCountry(country)) {
    throw new HttpError(400, 'A valid country (UAE, UGANDA, KENYA, or CHINA) is required');
  }

  const result = await marketplace.registerAccount(email.trim(), password, name.trim(), country);
  res.status(201).json({ linked: false, verificationRequired: true, message: result.message });
});

// DELETE /api/marketplace/account — unlink (log out of the marketplace on this device)
router.delete('/account', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  await prisma.marketplaceLink.deleteMany({ where: { sessionId } });
  res.status(204).end();
});

/**
 * Runs a marketplace call with the session's stored access token,
 * transparently refreshing it once on a 401 (the access token expires
 * in ~1h — see lib/marketplace.ts) rather than making the viewer log
 * in again just because time passed since their last visit.
 *
 * Returned as a closure (rather than a one-shot function) because
 * checkout below calls this once per seller group: the marketplace
 * ROTATES the refresh token on every refresh, invalidating the
 * previous one — so if group 1 triggers a refresh, group 2 must reuse
 * THAT rotated token, not the one originally loaded from the DB, or
 * its own refresh attempt would fail against an already-invalidated
 * token. `tokens` is the shared, mutable, up-to-date pair every group
 * reads and updates through this same closure.
 */
function makeTokenRunner(sessionId: string, link: { marketplaceToken: string; marketplaceRefreshToken: string }) {
  const tokens = { access: link.marketplaceToken, refresh: link.marketplaceRefreshToken };
  return async function withValidToken<T>(fn: (accessToken: string) => Promise<T>): Promise<T> {
    try {
      return await fn(tokens.access);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        const refreshed = await marketplace.refreshAccessToken(tokens.refresh);
        tokens.access = refreshed.accessToken;
        tokens.refresh = refreshed.refreshToken;
        await prisma.marketplaceLink.update({
          where: { sessionId },
          data: { marketplaceToken: tokens.access, marketplaceRefreshToken: tokens.refresh },
        });
        return await fn(tokens.access);
      }
      throw err;
    }
  };
}

interface CheckoutRequestItem extends MarketplaceCheckoutItem {
  /** Which seller's listing this is — see the same-seller grouping note below. */
  sellerId?: string;
}

// POST /api/marketplace/checkout  { items: [{ productId, quantity, sellerId? }] }
//
// Requires an already-linked marketplace account for this session (see
// GET /account). The marketplace's own /api/orders endpoint requires
// every item in ONE order to belong to the same seller — so items are
// grouped by sellerId here and placed as separate orders per seller.
// An item with no sellerId is treated as its own single-item group
// (safe default; the marketplace still validates everything itself).
router.post('/checkout', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'At least one item is required');
  }
  const parsedItems: CheckoutRequestItem[] = items.map((item, i) => {
    if (!item || typeof item.productId !== 'string' || !item.productId) {
      throw new HttpError(400, `Item ${i + 1} requires a productId`);
    }
    if (typeof item.quantity !== 'number' || item.quantity < 1) {
      throw new HttpError(400, `Item ${i + 1} requires a quantity of at least 1`);
    }
    return {
      productId: item.productId,
      quantity: item.quantity,
      sellerId: typeof item.sellerId === 'string' && item.sellerId ? item.sellerId : undefined,
    };
  });

  const link = await prisma.marketplaceLink.findUnique({ where: { sessionId } });
  if (!link) {
    throw new HttpError(401, 'No marketplace account is linked for this session');
  }

  // Group by seller (falling back to one group per item when sellerId
  // is missing) so each group can be placed as its own valid order.
  const groups = new Map<string, MarketplaceCheckoutItem[]>();
  parsedItems.forEach((item, i) => {
    const key = item.sellerId || `__ungrouped_${i}`;
    const group = groups.get(key) || [];
    group.push({ productId: item.productId, quantity: item.quantity });
    groups.set(key, group);
  });

  const orders: MarketplaceCheckoutResult[] = [];
  const failed: Array<{ items: MarketplaceCheckoutItem[]; error: string }> = [];
  const withValidToken = makeTokenRunner(sessionId, link);

  for (const groupItems of groups.values()) {
    try {
      const order = await withValidToken((token) => marketplace.checkout(token, groupItems));
      orders.push(order);
    } catch (err) {
      failed.push({ items: groupItems, error: err instanceof Error ? err.message : 'Checkout failed' });
    }
  }

  if (orders.length === 0) {
    // Every group failed — surface the first failure's status/message
    // rather than a generic 200 with an empty orders array.
    const first = failed[0];
    throw new HttpError(502, first?.error || 'Checkout failed');
  }

  res.status(201).json({ orders, failed: failed.length > 0 ? failed : undefined });
});

export default router;
