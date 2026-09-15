import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { HttpError } from '../lib/httpError';
import * as marketplace from '../lib/marketplace';
import { isValidMarketplaceCountry, MarketplaceCheckoutItem, toSearchResultDto } from '../lib/marketplace';

const router = Router();

// GET /api/marketplace/search?q=<text> — manual, user-typed search.
//
// Independent of the AI-identify pipeline in visual-search.ts: this
// lets a viewer type their own words and search the marketplace
// directly, which doubles as a way to verify whether an item genuinely
// exists there (bypassing whatever the AI identified). Uses the same
// query-shortening fallback as the visual-search pipeline, since the
// marketplace's own search is a verbatim substring match and even a
// typed multi-word phrase can miss a shorter real listing title.
router.get('/search', async (req: Request, res: Response) => {
  const q = req.query.q;
  if (typeof q !== 'string' || !q.trim()) {
    throw new HttpError(400, 'q query parameter is required');
  }
  console.log(`[Marketplace] manual search: "${q}"`);
  const outcome = await marketplace.searchProductsWithFallback(q);
  const results = outcome.results.slice(0, 12).map((p) => toSearchResultDto(p, q));
  res.json({ results, matchedQuery: outcome.matchedQuery });
});

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
  /** Which seller's listing this is — see the same-seller grouping note below.
   *  Absent means the item came from this app's own admin-managed catalog
   *  (the local phash-fallback search), not the external marketplace. */
  sellerId?: string;
  sellerName?: string;
  sellerContact?: string;
  // Snapshot of what the buyer saw at add-to-cart time — kept on the local
  // Order/OrderItem record so purchase history still shows the right name/
  // image/price even if the source listing later changes or disappears.
  name: string;
  price: string;
  image?: string;
}

interface DeliveryAddress {
  name: string;
  phone: string;
  address: string;
}

interface PaymentDetails {
  cardName: string;
  cardNumber: string;
  expiry: string;
}

function parseAddress(raw: unknown): DeliveryAddress {
  const a = (raw || {}) as Record<string, unknown>;
  const name = typeof a.name === 'string' ? a.name.trim() : '';
  const phone = typeof a.phone === 'string' ? a.phone.trim() : '';
  const address = typeof a.address === 'string' ? a.address.trim() : '';
  if (!name || !phone || !address) {
    throw new HttpError(400, 'A delivery name, phone number, and address are required to check out');
  }
  return { name, phone, address };
}

function parsePayment(raw: unknown): PaymentDetails {
  const p = (raw || {}) as Record<string, unknown>;
  const cardName = typeof p.cardName === 'string' ? p.cardName.trim() : '';
  const cardNumber = typeof p.cardNumber === 'string' ? p.cardNumber.replace(/\s+/g, '') : '';
  const expiry = typeof p.expiry === 'string' ? p.expiry.trim() : '';
  if (!cardName || !/^\d{12,19}$/.test(cardNumber) || !expiry) {
    throw new HttpError(400, 'Valid payment details (name on card, card number, expiry) are required for these items');
  }
  return { cardName, cardNumber, expiry };
}

interface CheckoutOrderResponse {
  source: 'admin' | 'marketplace';
  orderId: string;
  orderNumber?: string;
  status: string;
  sellerId?: string;
  sellerName?: string;
  sellerContact?: string;
}

// POST /api/marketplace/checkout
//   { items: [{ productId, quantity, name, price, image?, sellerId?, sellerName?, sellerContact? }],
//     address: { name, phone, address },
//     payment?: { cardName, cardNumber, expiry } }
//
// Two checkout paths run side by side, split by whether an item has a
// sellerId:
//
//  - Items WITHOUT a sellerId came from this app's own admin-managed
//    Product catalog (the local phash-fallback search) — there is no
//    external marketplace account to check out through, so this app
//    fulfills the order directly once `payment` is provided and
//    validated, and records it as a real local order.
//  - Items WITH a sellerId came from the real external marketplace and
//    go through the existing account-linked checkout below, grouped
//    per seller (the marketplace requires every item in one order to
//    share a seller — see marketplace.checkout()).
//
// A confirmed delivery address is required either way and is stored on
// every resulting local Order, so "Orders" on the profile page always
// shows what was actually confirmed at checkout time.
router.post('/checkout', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const { items, address: rawAddress, payment: rawPayment } = req.body || {};
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
    if (typeof item.name !== 'string' || !item.name) {
      throw new HttpError(400, `Item ${i + 1} requires a name`);
    }
    return {
      productId: item.productId,
      quantity: item.quantity,
      name: item.name,
      price: typeof item.price === 'string' ? item.price : '',
      image: typeof item.image === 'string' && item.image ? item.image : undefined,
      sellerId: typeof item.sellerId === 'string' && item.sellerId ? item.sellerId : undefined,
      sellerName: typeof item.sellerName === 'string' && item.sellerName ? item.sellerName : undefined,
      sellerContact: typeof item.sellerContact === 'string' && item.sellerContact ? item.sellerContact : undefined,
    };
  });

  const address = parseAddress(rawAddress);
  const adminItems = parsedItems.filter((i) => !i.sellerId);
  const marketplaceItems = parsedItems.filter((i) => i.sellerId);
  const payment = adminItems.length > 0 ? parsePayment(rawPayment) : null;

  const orders: CheckoutOrderResponse[] = [];
  const failed: Array<{ items: MarketplaceCheckoutItem[]; error: string }> = [];

  // --- Admin-catalog items: fulfilled directly by this app, no external
  //     marketplace account needed. "Payment" here is this app's own
  //     mock capture (there's no real payment gateway wired up) — only
  //     the last 4 digits are ever kept, never the full card number.
  if (adminItems.length > 0 && payment) {
    const order = await prisma.order.create({
      data: {
        sessionId,
        source: 'admin',
        status: 'PAID',
        sellerName: 'Piitrade',
        deliveryName: address.name,
        deliveryPhone: address.phone,
        deliveryAddress: address.address,
        paymentMethod: 'card',
        paymentLast4: payment.cardNumber.slice(-4),
        items: {
          create: adminItems.map((i) => ({
            productId: i.productId,
            name: i.name,
            image: i.image,
            price: i.price,
            quantity: i.quantity,
          })),
        },
      },
    });
    orders.push({ source: 'admin', orderId: order.id, status: order.status });
  }

  // --- Marketplace items: existing account-linked, per-seller checkout.
  if (marketplaceItems.length > 0) {
    const link = await prisma.marketplaceLink.findUnique({ where: { sessionId } });
    if (!link) {
      throw new HttpError(401, 'No marketplace account is linked for this session');
    }

    // Group by seller so each group can be placed as its own valid order
    // (the marketplace rejects a mixed-seller order — see marketplace.ts).
    const groups = new Map<string, CheckoutRequestItem[]>();
    marketplaceItems.forEach((item) => {
      const key = item.sellerId!;
      const group = groups.get(key) || [];
      group.push(item);
      groups.set(key, group);
    });

    const withValidToken = makeTokenRunner(sessionId, link);

    for (const groupItems of groups.values()) {
      const checkoutItems: MarketplaceCheckoutItem[] = groupItems.map((i) => ({ productId: i.productId, quantity: i.quantity }));
      try {
        const result = await withValidToken((token) => marketplace.checkout(token, checkoutItems));
        const first = groupItems[0];
        await prisma.order.create({
          data: {
            sessionId,
            source: 'marketplace',
            status: result.status,
            sellerId: first.sellerId,
            sellerName: first.sellerName,
            sellerContact: first.sellerContact,
            marketplaceOrderId: result.orderId,
            marketplaceOrderNumber: result.orderNumber,
            deliveryName: address.name,
            deliveryPhone: address.phone,
            deliveryAddress: address.address,
            items: {
              create: groupItems.map((i) => ({
                productId: i.productId,
                name: i.name,
                image: i.image,
                price: i.price,
                quantity: i.quantity,
              })),
            },
          },
        });
        orders.push({
          source: 'marketplace',
          orderId: result.orderId,
          orderNumber: result.orderNumber,
          status: result.status,
          sellerId: first.sellerId,
          sellerName: first.sellerName,
          sellerContact: first.sellerContact,
        });
      } catch (err) {
        failed.push({ items: checkoutItems, error: err instanceof Error ? err.message : 'Checkout failed' });
      }
    }
  }

  if (orders.length === 0) {
    // Every group failed — surface the first failure's status/message
    // rather than a generic 200 with an empty orders array.
    const first = failed[0];
    throw new HttpError(502, first?.error || 'Checkout failed');
  }

  // Where to send the buyer to actually complete a marketplace-sourced
  // transaction. The real marketplace (see MARKETPLACE_SITE_URL) has no
  // online payment gateway — its own homepage says "Meet in public,
  // inspect before paying", and its order-creation source defaults
  // every order to CASH_ON_DELIVERY — so there is no dedicated payment
  // page to link to. Its cart is the most direct real page toward
  // completing the transaction (contacting the seller / arranging
  // payment). Only relevant when at least one marketplace order went
  // through; admin-catalog orders are already fully paid above.
  const siteUrl = (process.env.MARKETPLACE_SITE_URL || '').replace(/\/+$/, '');
  const redirectUrl = siteUrl && orders.some((o) => o.source === 'marketplace') ? `${siteUrl}/cart` : undefined;

  res.status(201).json({ orders, failed: failed.length > 0 ? failed : undefined, redirectUrl });
});

// GET /api/marketplace/orders — this session's local purchase history
// (every Order written by a successful checkout above), newest first,
// with items included so the profile page can show real images/names/
// prices rather than just an order number.
router.get('/orders', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const orders = await prisma.order.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    include: { items: true },
  });
  res.json({ orders });
});

export default router;
