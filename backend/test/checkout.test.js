// Regression tests for POST /api/marketplace/checkout and the account
// link routes in backend/src/routes/marketplace.ts. Uses an in-memory
// fake Prisma client (see createFakePrisma below) since prisma generate
// can't run in this sandbox (see test/marketplace.test.js's db.js stub
// comment) — this one actually implements marketplaceLink storage
// in-memory rather than stubbing it out entirely, so the full route
// logic (grouping, token refresh, persistence) gets real coverage.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function createFakePrisma() {
  const links = new Map(); // keyed by sessionId (schema: MarketplaceLink.sessionId is unique)
  const orders = []; // local Order rows written by a successful checkout
  return {
    marketplaceLink: {
      findUnique: async ({ where }) => links.get(where.sessionId) || null,
      upsert: async ({ where, update, create }) => {
        const existing = links.get(where.sessionId);
        const row = existing ? { ...existing, ...update } : { id: `link-${where.sessionId}`, ...create };
        links.set(where.sessionId, row);
        return row;
      },
      update: async ({ where, data }) => {
        const existing = links.get(where.sessionId);
        if (!existing) throw new Error('record not found');
        const updated = { ...existing, ...data };
        links.set(where.sessionId, updated);
        return updated;
      },
      deleteMany: async ({ where }) => {
        const had = links.has(where.sessionId);
        links.delete(where.sessionId);
        return { count: had ? 1 : 0 };
      },
    },
    order: {
      create: async ({ data }) => {
        const { items, ...orderFields } = data;
        const id = `order-${orders.length + 1}`;
        const itemRows = (items?.create || []).map((it, idx) => ({ id: `${id}-item-${idx}`, orderId: id, ...it }));
        const row = { status: 'PENDING', createdAt: new Date(), ...orderFields, id, items: itemRows };
        orders.push(row);
        return row;
      },
      findMany: async ({ where }) => {
        return orders
          .filter((o) => o.sessionId === where.sessionId)
          .slice()
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      },
    },
    // exposed for test setup/assertions, not part of the real Prisma API
    __links: links,
    __orders: orders,
  };
}

const dbPath = path.resolve(__dirname, '../dist/db.js');
const fakePrisma = createFakePrisma();
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: fakePrisma } };

// --- Fake marketplace backend ---
// Tracks orders it "received" so tests can assert on seller grouping.
let receivedOrders = [];
let ordersEndpointBehavior = 'succeed'; // 'succeed' | 'unauthorized-once' | 'fail'
let unauthorizedOnceUsed = false;

const realFetch = global.fetch;
global.fetch = async (url, init) => {
  const u = new URL(url);
  if (u.hostname !== 'fake-marketplace.test') return realFetch(url, init);

  if (u.pathname === '/api/orders' && init?.method === 'POST') {
    const auth = (init.headers || {}).Authorization || '';
    if (ordersEndpointBehavior === 'unauthorized-once' && !unauthorizedOnceUsed) {
      unauthorizedOnceUsed = true;
      return { ok: false, status: 401, headers: { getSetCookie: () => [] }, json: async () => ({ message: 'Token expired' }) };
    }
    if (ordersEndpointBehavior === 'fail') {
      return { ok: false, status: 400, headers: { getSetCookie: () => [] }, json: async () => ({ message: 'Simulated failure' }) };
    }
    const body = JSON.parse(init.body);
    const order = { id: `order-${receivedOrders.length + 1}`, orderNumber: `PT-${1000 + receivedOrders.length}`, status: 'PENDING' };
    receivedOrders.push({ auth, items: body.items });
    return { ok: true, status: 201, headers: { getSetCookie: () => [] }, json: async () => ({ order }) };
  }

  if (u.pathname === '/api/auth/refresh' && init?.method === 'POST') {
    return {
      ok: true,
      status: 200,
      headers: { getSetCookie: () => ['refreshToken=new-refresh-token; Path=/api/auth; HttpOnly'] },
      json: async () => ({ accessToken: 'new-access-token' }),
    };
  }

  throw new Error(`Unhandled fake marketplace request: ${init?.method || 'GET'} ${u.pathname}`);
};

process.env.MARKETPLACE_API = 'https://fake-marketplace.test';
process.env.MARKETPLACE_SITE_URL = 'https://piitrade.com';

let server;
let base;

before(async () => {
  require('express-async-errors');
  const express = require('express');
  const marketplaceRouter = require('../dist/routes/marketplace.js').default;
  const { HttpError } = require('../dist/lib/httpError.js');

  const app = express();
  app.use(express.json());
  app.use('/api/marketplace', marketplaceRouter);
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  });

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(() => {
  server.close();
});

beforeEach(() => {
  receivedOrders = [];
  ordersEndpointBehavior = 'succeed';
  unauthorizedOnceUsed = false;
  fakePrisma.__links.clear();
  fakePrisma.__orders.length = 0;
});

const DEFAULT_ADDRESS = { name: 'Jane Buyer', phone: '+1 555 0100', address: '123 Main St, Springfield' };
const DEFAULT_PAYMENT = { cardName: 'Jane Buyer', cardNumber: '4242424242424242', expiry: '12/30' };

// Auto-fills `name`/`price` (required on every item since checkout now
// keeps a local snapshot for order history) and a valid delivery
// address (also required) so existing per-test item lists don't all
// need editing — only tests specifically about address/payment
// validation pass their own `opts`.
function checkoutBody(items, opts = {}) {
  const filledItems = items.map((item, i) => ({ name: `Item ${i + 1}`, price: '$10', ...item }));
  const payload = { items: filledItems, address: opts.address === undefined ? DEFAULT_ADDRESS : opts.address };
  if (opts.payment !== undefined) payload.payment = opts.payment;
  return JSON.stringify(payload);
}

test('checkout with no linked account returns HTTP 401', async () => {
  const res = await realFetch(`${base}/api/marketplace/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'session-1' },
    body: checkoutBody([{ productId: 'p1', quantity: 1, sellerId: 's1' }]),
  });
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.match(body.error, /no marketplace account is linked/i);
});

test('checkout with missing X-Session-Id returns HTTP 400', async () => {
  const res = await realFetch(`${base}/api/marketplace/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: checkoutBody([{ productId: 'p1', quantity: 1 }]),
  });
  assert.equal(res.status, 400);
});

test('checkout with no items returns HTTP 400', async () => {
  const res = await realFetch(`${base}/api/marketplace/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'session-1' },
    body: checkoutBody([]),
  });
  assert.equal(res.status, 400);
});

test('checkout with an invalid quantity returns HTTP 400', async () => {
  const res = await realFetch(`${base}/api/marketplace/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'session-1' },
    body: checkoutBody([{ productId: 'p1', quantity: 0, sellerId: 's1' }]),
  });
  assert.equal(res.status, 400);
});

test('a successful checkout places one order and returns the redirect URL to the marketplace cart, not any other page', async () => {
  fakePrisma.__links.set('session-2', {
    sessionId: 'session-2',
    marketplaceToken: 'valid-token',
    marketplaceRefreshToken: 'valid-refresh',
    marketplaceUserId: 'user-1',
  });

  const res = await realFetch(`${base}/api/marketplace/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'session-2' },
    body: checkoutBody([{ productId: 'p1', quantity: 2, sellerId: 'seller-a' }]),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.orders.length, 1);
  assert.equal(body.orders[0].orderNumber, 'PT-1000');
  assert.equal(body.redirectUrl, 'https://piitrade.com/cart', 'must go straight to the marketplace cart, not the homepage or any other page');
  assert.equal(receivedOrders.length, 1);
  assert.equal(receivedOrders[0].auth, 'Bearer valid-token');
});

test('items from different sellers are placed as separate orders (the marketplace requires one seller per order)', async () => {
  fakePrisma.__links.set('session-3', {
    sessionId: 'session-3',
    marketplaceToken: 'valid-token',
    marketplaceRefreshToken: 'valid-refresh',
    marketplaceUserId: 'user-1',
  });

  const res = await realFetch(`${base}/api/marketplace/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'session-3' },
    body: checkoutBody([
      { productId: 'p1', quantity: 1, sellerId: 'seller-a' },
      { productId: 'p2', quantity: 1, sellerId: 'seller-b' },
      { productId: 'p3', quantity: 1, sellerId: 'seller-a' },
    ]),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.orders.length, 2, 'seller-a items and seller-b items must be two separate orders');
  assert.equal(receivedOrders.length, 2);
  const sellerAOrder = receivedOrders.find((o) => o.items.length === 2);
  const sellerBOrder = receivedOrders.find((o) => o.items.length === 1);
  assert.ok(sellerAOrder, 'expected one order grouping both seller-a items together');
  assert.ok(sellerBOrder, 'expected a separate order for the seller-b item');
});

test('an expired access token is transparently refreshed and the order still succeeds', async () => {
  fakePrisma.__links.set('session-4', {
    sessionId: 'session-4',
    marketplaceToken: 'expired-token',
    marketplaceRefreshToken: 'old-refresh',
    marketplaceUserId: 'user-1',
  });
  ordersEndpointBehavior = 'unauthorized-once';

  const res = await realFetch(`${base}/api/marketplace/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'session-4' },
    body: checkoutBody([{ productId: 'p1', quantity: 1, sellerId: 'seller-a' }]),
  });
  const body = await res.json();

  assert.equal(res.status, 201, 'checkout should succeed after transparently refreshing the expired token');
  assert.equal(body.orders.length, 1);
  assert.equal(receivedOrders.length, 1);
  assert.equal(receivedOrders[0].auth, 'Bearer new-access-token', 'the retried order call must use the refreshed token');

  const storedLink = fakePrisma.__links.get('session-4');
  assert.equal(storedLink.marketplaceToken, 'new-access-token', 'the refreshed token must be persisted for next time');
  assert.equal(storedLink.marketplaceRefreshToken, 'new-refresh-token');
});

test('a group whose order fails is reported in `failed`, without blocking other groups from succeeding', async () => {
  fakePrisma.__links.set('session-5', {
    sessionId: 'session-5',
    marketplaceToken: 'valid-token',
    marketplaceRefreshToken: 'valid-refresh',
    marketplaceUserId: 'user-1',
  });

  // First checkout call (seller-a) succeeds normally; we then flip the
  // fake marketplace to always-fail and checkout a second, different
  // seller group to see it reported in `failed` on its own.
  await realFetch(`${base}/api/marketplace/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'session-5' },
    body: checkoutBody([{ productId: 'p1', quantity: 1, sellerId: 'seller-a' }]),
  });

  ordersEndpointBehavior = 'fail';
  const res = await realFetch(`${base}/api/marketplace/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'session-5' },
    body: checkoutBody([{ productId: 'p2', quantity: 1, sellerId: 'seller-b' }]),
  });
  const body = await res.json();

  // Every group in THIS request failed, so the route surfaces it as an error.
  assert.equal(res.status, 502);
  assert.match(body.error, /Simulated failure/);
});

test('GET /api/marketplace/account reflects linked status, and DELETE unlinks', async () => {
  const before1 = await realFetch(`${base}/api/marketplace/account`, { headers: { 'X-Session-Id': 'session-6' } });
  assert.deepEqual(await before1.json(), { linked: false });

  fakePrisma.__links.set('session-6', {
    sessionId: 'session-6',
    marketplaceToken: 't',
    marketplaceRefreshToken: 'r',
    marketplaceUserId: 'u',
  });
  const after1 = await realFetch(`${base}/api/marketplace/account`, { headers: { 'X-Session-Id': 'session-6' } });
  assert.deepEqual(await after1.json(), { linked: true });

  const del = await realFetch(`${base}/api/marketplace/account`, { method: 'DELETE', headers: { 'X-Session-Id': 'session-6' } });
  assert.equal(del.status, 204);
  const after2 = await realFetch(`${base}/api/marketplace/account`, { headers: { 'X-Session-Id': 'session-6' } });
  assert.deepEqual(await after2.json(), { linked: false });
});

test('checkout without a delivery address returns HTTP 400', async () => {
  const res = await realFetch(`${base}/api/marketplace/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'session-7' },
    body: checkoutBody([{ productId: 'p1', quantity: 1, sellerId: 's1' }], { address: { name: '', phone: '', address: '' } }),
  });
  assert.equal(res.status, 400);
});

// Items with no sellerId came from Piitrade's own admin-managed catalog
// (not a third-party marketplace seller) — no account link is needed at
// all, but real payment details are required and the order is
// fulfilled directly, recorded locally as PAID.
test('an admin-catalog item (no sellerId) requires payment but no marketplace account, and is fulfilled directly', async () => {
  const res = await realFetch(`${base}/api/marketplace/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'session-8' },
    body: checkoutBody([{ productId: 'admin-p1', quantity: 1 }]), // no payment in opts yet
  });
  assert.equal(res.status, 400, 'payment details are required for admin-catalog items');

  const paidRes = await realFetch(`${base}/api/marketplace/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'session-8' },
    body: checkoutBody([{ productId: 'admin-p1', quantity: 1 }], { payment: DEFAULT_PAYMENT }),
  });
  const body = await paidRes.json();
  assert.equal(paidRes.status, 201);
  assert.equal(body.orders.length, 1);
  assert.equal(body.orders[0].source, 'admin');
  assert.equal(body.orders[0].status, 'PAID');
  assert.equal(receivedOrders.length, 0, 'an admin-catalog checkout must never call the external marketplace');
  assert.equal(body.redirectUrl, undefined, 'no marketplace redirect is needed when nothing went through the marketplace');

  const stored = fakePrisma.__orders.find((o) => o.id === body.orders[0].orderId);
  assert.ok(stored, 'the admin order must be persisted locally so it shows up in purchase history');
  assert.equal(stored.paymentLast4, '4242', 'only the last 4 digits of the card are ever kept');
  assert.equal(stored.items[0].productId, 'admin-p1');
});

test('a mixed cart (admin item + marketplace item) produces both an admin order and a marketplace order', async () => {
  fakePrisma.__links.set('session-9', {
    sessionId: 'session-9',
    marketplaceToken: 'valid-token',
    marketplaceRefreshToken: 'valid-refresh',
    marketplaceUserId: 'user-1',
  });

  const res = await realFetch(`${base}/api/marketplace/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'session-9' },
    body: checkoutBody(
      [
        { productId: 'admin-p1', quantity: 1 },
        { productId: 'mkt-p1', quantity: 1, sellerId: 'seller-a', sellerName: 'Ada', sellerContact: 'ada@example.com' },
      ],
      { payment: DEFAULT_PAYMENT }
    ),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.orders.length, 2);
  assert.ok(body.orders.some((o) => o.source === 'admin'));
  const mktOrder = body.orders.find((o) => o.source === 'marketplace');
  assert.ok(mktOrder);
  assert.equal(mktOrder.sellerName, 'Ada');
  assert.equal(mktOrder.sellerContact, 'ada@example.com');
  assert.equal(body.redirectUrl, 'https://piitrade.com/cart', 'redirect is still needed since a marketplace order was placed');
});

test('GET /api/marketplace/orders returns this session\'s purchase history, newest first, with items', async () => {
  await realFetch(`${base}/api/marketplace/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'session-10' },
    body: checkoutBody([{ productId: 'admin-p1', name: 'First thing', quantity: 1 }], { payment: DEFAULT_PAYMENT }),
  });
  await realFetch(`${base}/api/marketplace/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'session-10' },
    body: checkoutBody([{ productId: 'admin-p2', name: 'Second thing', quantity: 2 }], { payment: DEFAULT_PAYMENT }),
  });

  const res = await realFetch(`${base}/api/marketplace/orders`, { headers: { 'X-Session-Id': 'session-10' } });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.orders.length, 2);
  assert.equal(body.orders[0].items[0].name, 'Second thing', 'most recent order must come first');
  assert.equal(body.orders[1].items[0].name, 'First thing');
  assert.equal(body.orders[0].deliveryAddress, DEFAULT_ADDRESS.address);
});
