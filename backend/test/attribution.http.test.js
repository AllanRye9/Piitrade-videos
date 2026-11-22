const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// ---- in-memory stand-in for the parts of Prisma the attribution routes use
const site = { id: 's1', slug: 'shop', name: 'Shop', baseUrl: 'https://shop.com', active: true, commissionPct: 10, postbackSecret: 'sec-123' };
const db = { videos: [{ id: 'v1', uploaderSessionId: 'creator' }], products: [{ id: 'p1', videoId: 'v1', url: 'https://shop.com/p/1', siteId: 's1', site }], clicks: [], conversions: [], payouts: [] };
let seq = 0;
const match = (row, where) => Object.entries(where).every(([k, v]) => (v && typeof v === 'object' && 'gte' in v ? row[k] >= v.gte : row[k] === v));
const fake = {
  site: { findMany: async () => [site], findUnique: async ({ where }) => (where.slug === site.slug ? site : null) },
  video: { findUnique: async ({ where }) => db.videos.find((v) => v.id === where.id) || null },
  videoProduct: { findFirst: async ({ where }) => db.products.find((p) => p.id === where.id && p.videoId === where.videoId) || null },
  click: {
    findFirst: async ({ where }) => [...db.clicks].reverse().find((c) => match(c, where)) || null,
    findUnique: async ({ where }) => db.clicks.find((c) => c.token === where.token) || null,
    create: async ({ data }) => { const row = { id: `c${++seq}`, createdAt: new Date(), ...data }; db.clicks.push(row); return row; },
  },
  conversion: {
    create: async ({ data }) => {
      if (db.conversions.some((c) => c.siteId === data.siteId && c.externalOrderId === data.externalOrderId)) throw Object.assign(new Error('dup'), { code: 'P2002' });
      const row = { id: `cv${++seq}`, createdAt: new Date(), ...data }; db.conversions.push(row); return row;
    },
  },
  payoutEntry: {
    create: async ({ data }) => { const row = { id: `p${++seq}`, status: 'pending', createdAt: new Date(), ...data }; db.payouts.push(row); return row; },
    groupBy: async () => [], findMany: async () => [],
  },
  $transaction: async (fn) => fn(fake),
};
const dbPath = require.resolve('../dist/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: fake } };

require('express-async-errors'); // same as src/index.ts: lets async handlers throw HttpError
const express = require('express');
const { signPostback, hashId } = require('../dist/lib/attribution');
const attribution = require('../dist/routes/attribution');

let server, base;
before(async () => {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use('/api/attribution', attribution.default);
  app.use(attribution.goRouter);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
function postback(payload, { secret = site.postbackSecret, ts = String(Date.now()), slug = 'shop' } = {}) {
  const raw = JSON.stringify(payload);
  return post('/api/attribution/conversion', raw, { 'x-piitrade-site': slug, 'x-piitrade-timestamp': ts, 'x-piitrade-signature': signPostback(secret, ts, raw) });
}
const tokenOf = (url) => new URL(url).searchParams.get('pv_click');

test('in-app click returns the shop URL with a click token and logs it against the creator', async () => {
  const r = await post('/api/attribution/click', { videoId: 'v1', productId: 'p1' }, { 'x-session-id': 'viewer-1' });
  assert.equal(r.status, 200);
  const { url } = await r.json();
  assert.ok(url.startsWith('https://shop.com/p/1?'));
  assert.ok(tokenOf(url));
  const row = db.clicks.find((c) => c.token === tokenOf(url));
  assert.equal(row.creatorSessionId, 'creator');
  assert.equal(row.viewerHash, hashId('viewer-1'));
  assert.ok(!JSON.stringify(row).includes('viewer-1')); // only the hash is stored
});

test('a rapid repeat tap by the same viewer reuses the click instead of inflating the count', async () => {
  const a = await (await post('/api/attribution/click', { videoId: 'v1', productId: 'p1' }, { 'x-session-id': 'viewer-2' })).json();
  const before = db.clicks.length;
  const b = await (await post('/api/attribution/click', { videoId: 'v1', productId: 'p1' }, { 'x-session-id': 'viewer-2' })).json();
  assert.equal(tokenOf(a.url), tokenOf(b.url));
  assert.equal(db.clicks.length, before);
});

test('links to a non-connected host are refused (no open redirect)', async () => {
  const r = await post('/api/attribution/click', { videoId: 'v1', url: 'https://evil.com/phish' }, { 'x-session-id': 'viewer-3' });
  assert.equal(r.status, 400);
  const ok = await post('/api/attribution/click', { videoId: 'v1', url: 'https://shop.com/listings/9' }, { 'x-session-id': 'viewer-3' });
  assert.equal(ok.status, 200);
  assert.equal((await post('/api/attribution/click', { videoId: 'nope', productId: 'p1' })).status, 404);
});

test('anonymous taps never reuse a signed-in viewer’s click, but do de-duplicate among themselves', async () => {
  await post('/api/attribution/click', { videoId: 'v1', productId: 'p1' }, { 'x-session-id': 'viewer-NAT' });
  const a = await fetch(`${base}/go/v1/p1`, { redirect: 'manual' });
  const b = await fetch(`${base}/go/v1/p1`, { redirect: 'manual' });
  const ta = tokenOf(a.headers.get('location')), tb = tokenOf(b.headers.get('location'));
  assert.equal(ta, tb); // double-tap by the same anonymous visitor
  assert.equal(db.clicks.find((c) => c.token === ta).viewerHash, null);
});

test('GET /go redirects (302) to the product with attribution and logs an anonymous click', async () => {
  const r = await fetch(`${base}/go/v1/p1`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  const loc = r.headers.get('location');
  assert.ok(loc.startsWith('https://shop.com/p/1') && tokenOf(loc));
  const row = db.clicks.find((c) => c.token === tokenOf(loc));
  assert.ok(row.ipHash && !row.viewerHash);
  assert.equal((await fetch(`${base}/go/v1?url=${encodeURIComponent('https://evil.com')}`, { redirect: 'manual' })).status, 400);
});

test('a signed conversion credits the creator the site’s commission', async () => {
  const { url } = await (await post('/api/attribution/click', { videoId: 'v1', productId: 'p1' }, { 'x-session-id': 'buyer-A' })).json();
  const r = await postback({ clickToken: tokenOf(url), orderId: 'ORD-1', amount: 50000, currency: 'ugx' });
  assert.equal(r.status, 201);
  const out = await r.json();
  assert.equal(out.credited, true);
  const payout = db.payouts.find((p) => p.conversionId === out.conversionId);
  assert.equal(payout.creatorSessionId, 'creator');
  assert.equal(payout.amountMinor, BigInt(500000)); // 10% of 50,000.00 → 5,000.00 = 500,000 minor
  assert.equal(payout.currency, 'UGX');
});

test('replaying the same postback does not double-count', async () => {
  const { url } = await (await post('/api/attribution/click', { videoId: 'v1', productId: 'p1' }, { 'x-session-id': 'buyer-B' })).json();
  const payload = { clickToken: tokenOf(url), orderId: 'ORD-REPLAY', amount: 1000, currency: 'UGX' };
  const first = await postback(payload);
  const second = await postback(payload);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).duplicate, true);
  assert.equal(db.conversions.filter((c) => c.externalOrderId === 'ORD-REPLAY').length, 1);
  assert.equal(db.payouts.filter((p) => p.conversionId === db.conversions.find((c) => c.externalOrderId === 'ORD-REPLAY').id).length, 1);
});

test('bad signature, wrong secret, unknown site and stale timestamp are all 401', async () => {
  const { url } = await (await post('/api/attribution/click', { videoId: 'v1', productId: 'p1' }, { 'x-session-id': 'buyer-C' })).json();
  const payload = { clickToken: tokenOf(url), orderId: 'ORD-SEC', amount: 1000, currency: 'UGX' };
  assert.equal((await postback(payload, { secret: 'wrong' })).status, 401);
  assert.equal((await postback(payload, { slug: 'unknown' })).status, 401);
  assert.equal((await postback(payload, { ts: String(Date.now() - 3600_000) })).status, 401);
  assert.equal((await post('/api/attribution/conversion', JSON.stringify(payload))).status, 400); // no headers
  assert.equal(db.conversions.some((c) => c.externalOrderId === 'ORD-SEC'), false);
});

test('unknown token → 404, expired click → 422, invalid amount → 400', async () => {
  assert.equal((await postback({ clickToken: 'nope', orderId: 'X1', amount: 5, currency: 'UGX' })).status, 404);
  const { url } = await (await post('/api/attribution/click', { videoId: 'v1', productId: 'p1' }, { 'x-session-id': 'buyer-D' })).json();
  assert.equal((await postback({ clickToken: tokenOf(url), orderId: 'X2', amount: -5, currency: 'UGX' })).status, 400);
  db.clicks.find((c) => c.token === tokenOf(url)).createdAt = new Date(Date.now() - 40 * 86400_000);
  assert.equal((await postback({ clickToken: tokenOf(url), orderId: 'X3', amount: 5, currency: 'UGX' })).status, 422);
});

test('a creator buying through their own link is recorded but earns nothing', async () => {
  const { url } = await (await post('/api/attribution/click', { videoId: 'v1', productId: 'p1' }, { 'x-session-id': 'creator' })).json();
  const r = await postback({ clickToken: tokenOf(url), orderId: 'ORD-SELF', amount: 20000, currency: 'UGX' });
  const out = await r.json();
  assert.equal(r.status, 201);
  assert.equal(out.selfReferral, true);
  assert.equal(out.credited, false);
  assert.equal(db.payouts.some((p) => p.conversionId === out.conversionId), false);
});
