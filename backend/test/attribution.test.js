const { test } = require('node:test');
const assert = require('node:assert/strict');
const dbPath = require.resolve('../dist/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: {} } };

const A = require('../dist/lib/attribution');
const M = require('../dist/lib/money');
const R = require('../dist/lib/feedRank');
const S = require('../dist/lib/shoppable');
const L = require('../dist/lib/listingSpec');
const E = require('../dist/lib/embedPages');
const K = require('../dist/lib/keyframes');
const { isPublicHttpUrl } = require('../dist/lib/sites');
const { normalizePermissions, ALL_PERMISSIONS } = require('../dist/lib/permissions');

// ---- money
test('toMinor parses amounts exactly and rejects junk', () => {
  assert.equal(M.toMinor('12.5'), BigInt(1250));
  assert.equal(M.toMinor(800000), BigInt(80000000));
  assert.equal(M.toMinor(0.1 + 0.2), BigInt(30)); // float noise rounds away
  for (const bad of [0, -5, 'abc', NaN, Infinity, null, undefined, 1e13]) assert.equal(M.toMinor(bad), null, String(bad));
});
test('commissionMinor rounds to a minor unit and clamps pct', () => {
  assert.equal(M.commissionMinor(BigInt(10000), 5), BigInt(500));
  assert.equal(M.commissionMinor(BigInt(333), 10), BigInt(33));
  assert.equal(M.commissionMinor(BigInt(1000), 150), BigInt(1000));
  assert.equal(M.commissionMinor(BigInt(1000), -4), BigInt(0));
  assert.equal(M.commissionMinor(BigInt(1000), NaN), BigInt(0));
});

// ---- URLs
test('normalizeProductUrl strips tracking, www, hash and trailing slash', () => {
  const k = 'shop.com/p/42';
  assert.equal(A.normalizeProductUrl('https://www.Shop.com/p/42/?utm_source=x&pv_click=abc#frag'), k);
  assert.equal(A.normalizeProductUrl('http://shop.com/p/42'), k);
  assert.equal(A.normalizeProductUrl('https://shop.com/p?b=2&a=1'), 'shop.com/p?a=1&b=2');
  assert.equal(A.normalizeProductUrl('javascript:alert(1)'), null);
  assert.equal(A.normalizeProductUrl('not a url'), null);
});
test('hostMatchesSite allows the shop and its subdomains only', () => {
  assert.ok(A.hostMatchesSite('https://piitrade.com/listings/1', 'https://piitrade.com'));
  assert.ok(A.hostMatchesSite('https://www.piitrade.com/x', 'https://piitrade.com'));
  assert.ok(A.hostMatchesSite('https://m.piitrade.com/x', 'https://piitrade.com'));
  assert.ok(!A.hostMatchesSite('https://piitrade.com.evil.io/x', 'https://piitrade.com'));
  assert.ok(!A.hostMatchesSite('https://evilpiitrade.com/x', 'https://piitrade.com'));
  assert.ok(!A.hostMatchesSite('garbage', 'https://piitrade.com'));
});
test('withClickParams adds utm + click token and keeps existing query', () => {
  const u = new URL(A.withClickParams('https://shop.com/p/1?color=red', { token: 'T0K', videoId: 'v1' }));
  assert.equal(u.searchParams.get('pv_click'), 'T0K');
  assert.equal(u.searchParams.get('utm_source'), 'piitrade_videos');
  assert.equal(u.searchParams.get('utm_campaign'), 'v1');
  assert.equal(u.searchParams.get('color'), 'red');
});
test('click tokens are unique and URL-safe; hashes are salted and stable', () => {
  const a = A.newClickToken(), b = A.newClickToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{20,}$/);
  assert.equal(A.hashId('sess-1'), A.hashId('sess-1'));
  assert.notEqual(A.hashId('sess-1'), A.hashId('sess-2'));
  assert.ok(!A.hashId('sess-1').includes('sess-1'));
});

// ---- signed postbacks
const SECRET = 'shop-secret';
const body = JSON.stringify({ clickToken: 't', orderId: 'o1', amount: 100, currency: 'UGX' });
test('a correctly signed postback verifies (with or without sha256= prefix)', () => {
  const ts = String(Date.now());
  const sig = A.signPostback(SECRET, ts, body);
  assert.ok(A.verifyPostback(SECRET, ts, body, sig));
  assert.ok(A.verifyPostback(SECRET, ts, body, `sha256=${sig}`));
});
test('tampered body, wrong secret, garbage signature are rejected', () => {
  const ts = String(Date.now());
  const sig = A.signPostback(SECRET, ts, body);
  assert.ok(!A.verifyPostback(SECRET, ts, body.replace('100', '999999'), sig));
  assert.ok(!A.verifyPostback('other', ts, body, sig));
  assert.ok(!A.verifyPostback(SECRET, ts, body, 'zz'));
  assert.ok(!A.verifyPostback(SECRET, ts, body, ''));
  assert.ok(!A.verifyPostback(SECRET, ts, body, sig.slice(0, 10)));
});
test('old or future timestamps are rejected (replay window)', () => {
  const now = 1_700_000_000_000;
  const ok = String(now - 60_000), old = String(now - 10 * 60_000), future = String(now + 10 * 60_000);
  assert.ok(A.verifyPostback(SECRET, ok, body, A.signPostback(SECRET, ok, body), now));
  assert.ok(!A.verifyPostback(SECRET, old, body, A.signPostback(SECRET, old, body), now));
  assert.ok(!A.verifyPostback(SECRET, future, body, A.signPostback(SECRET, future, body), now));
  assert.ok(!A.verifyPostback(SECRET, 'abc', body, A.signPostback(SECRET, 'abc', body), now));
});
test('parseConversion validates required fields', () => {
  assert.deepEqual(A.parseConversion({ clickToken: 't', orderId: 'o', amount: 5, currency: 'ugx' }).currency, 'UGX');
  for (const bad of [{}, { clickToken: 't', orderId: 'o', currency: 'UG' }, { clickToken: '', orderId: 'o', currency: 'UGX' }, { clickToken: 't', orderId: '', currency: 'UGX' }]) {
    assert.ok('error' in A.parseConversion(bad));
  }
});
test('payout status machine only allows sensible moves', () => {
  assert.ok(A.canTransition('pending', 'approved'));
  assert.ok(A.canTransition('approved', 'paid'));
  assert.ok(A.canTransition('paid', 'reversed'));
  assert.ok(!A.canTransition('paid', 'pending'));
  assert.ok(!A.canTransition('reversed', 'approved'));
  assert.ok(!A.canTransition('pending', 'paid'));
  assert.ok(!A.canTransition('nonsense', 'paid'));
});

// ---- ranking
test('conversion multiplier is neutral at the prior, boosts sellers, caps both ways', () => {
  assert.ok(Math.abs(R.conversionMultiplier(0, 0) - 1) < 1e-9);
  assert.ok(R.conversionMultiplier(100, 30) > 1.3);
  assert.equal(R.conversionMultiplier(1000, 900), 1 + R.MAX_BOOST);
  assert.ok(R.conversionMultiplier(2000, 0) < 1 && R.conversionMultiplier(2000, 0) >= 1 - R.MAX_PENALTY);
});
test('cold start: one lucky sale barely moves a video with almost no clicks', () => {
  assert.ok(R.conversionMultiplier(1, 1) < 1.5);
  assert.ok(R.conversionMultiplier(1, 1) < R.conversionMultiplier(100, 30));
});
test('a selling video outranks an identical non-selling one; newer beats older', () => {
  const base = { likes: 10, comments: 2, shares: 1, views: 500, createdAt: new Date(Date.now() - 3600_000) };
  assert.ok(R.scoreVideo({ ...base, clicks: 100, conversions: 20 }) > R.scoreVideo({ ...base, clicks: 100, conversions: 0 }));
  assert.ok(R.scoreVideo({ ...base, clicks: 0, conversions: 0 }) > R.scoreVideo({ ...base, createdAt: new Date(Date.now() - 48 * 3600_000), clicks: 0, conversions: 0 }));
});

// ---- shoppable products
const SITES = [{ id: 's1', baseUrl: 'https://piitrade.com' }];
test('validateProducts accepts good input and normalises it', () => {
  const r = S.validateProducts([{ url: 'https://piitrade.com/listings/1', title: ' Sofa ', startMs: 1000, endMs: 5000, x: 0.5, y: 0.25 }], SITES, 30);
  assert.equal(r.products.length, 1);
  assert.deepEqual([r.products[0].siteId, r.products[0].title, r.products[0].position, r.products[0].urlKey], ['s1', 'Sofa', 0, 'piitrade.com/listings/1']);
});
test('validateProducts rejects off-shop links, bad times, bad hotspots, too many', () => {
  const bad = (p, d = 30) => 'error' in S.validateProducts([p], SITES, d);
  assert.ok(bad({ url: 'https://evil.com/x' }));
  assert.ok(bad({ url: 'ftp://piitrade.com/x' }));
  assert.ok(bad({ url: '' }));
  assert.ok(bad({ url: 'https://piitrade.com/a', startMs: -1 }));
  assert.ok(bad({ url: 'https://piitrade.com/a', startMs: 5000, endMs: 5000 }));
  assert.ok(bad({ url: 'https://piitrade.com/a', startMs: 31000 }));
  assert.ok(bad({ url: 'https://piitrade.com/a', startMs: 0, endMs: 99000 }));
  assert.ok(bad({ url: 'https://piitrade.com/a', x: 0.5 }));
  assert.ok(bad({ url: 'https://piitrade.com/a', x: 2, y: 0.5 }));
  assert.ok(bad({ url: 'https://piitrade.com/a', startMs: 1.5 }));
  const nine = Array.from({ length: 9 }, () => ({ url: 'https://piitrade.com/a' }));
  assert.ok('error' in S.validateProducts(nine, SITES, 30));
  assert.ok('error' in S.validateProducts('nope', SITES, 30));
});
test('empty / missing products are fine', () => {
  assert.deepEqual(S.validateProducts(undefined, SITES, 10), { products: [] });
  assert.deepEqual(S.validateProducts([], SITES, 10), { products: [] });
});
test('activeProducts honours windows; no end = until the video ends', () => {
  const ps = [{ id: 'a', startMs: 0, endMs: 2000 }, { id: 'b', startMs: 1000, endMs: null }, { id: 'c', startMs: 3000, endMs: 4000 }];
  assert.deepEqual(S.activeProducts(ps, 500).map((p) => p.id), ['a']);
  assert.deepEqual(S.activeProducts(ps, 1500).map((p) => p.id), ['a', 'b']);
  assert.deepEqual(S.activeProducts(ps, 2000).map((p) => p.id), ['b']); // end is exclusive
  assert.deepEqual(S.activeProducts(ps, 3500).map((p) => p.id), ['b', 'c']);
});

// ---- listing spec validator
test('listing spec validator flags missing fields, accepts a good response', () => {
  assert.ok(!L.validateListingsResponse({}).ok);
  assert.ok(!L.validateListingsResponse({ listings: [{ title: 'x', price: 1 }] }).ok);
  const good = L.validateListingsResponse({ listings: [{ id: 1, title: 'Sofa', price: '500', productImages: [{ cdnUrl: 'https://cdn/x.jpg' }] }] });
  assert.ok(good.ok);
  assert.equal(good.issues.length, 0);
  assert.ok(L.validateListingsResponse({ listings: [{ id: 1, title: 'S', price: 1 }] }).issues.some((i) => i.level === 'warning'));
});

// ---- embed pages
const ctx = { origin: 'https://v.example.com' };
const video = { id: 'abc', title: '<script>alert(1)</script> "Sofa"', description: 'd', fileUrl: 'https://v.example.com/uploads/videos/a.mp4', posterUrl: null, duration: 12, createdAt: new Date('2026-01-01'), uploaderHandle: 'amina', views: 5, likes: 2 };
test('HTML pages escape user-controlled text; JSON-LD can’t break out of the script tag', () => {
  const html = E.permalinkPageHtml(video, [{ id: 'p1', title: '</script><b>x', host: 'shop.com', startMs: 0, endMs: null }], ctx);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('</script><b>x'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('application/json+oembed'));
  assert.ok(html.includes('"@type":"VideoObject"'));
  assert.ok(E.embedPageHtml(video, [], ctx).includes('<video'));
});
test('product chips link through the attribution redirect, never the raw shop URL', () => {
  const html = E.embedPageHtml(video, [{ id: 'p1', title: 'Sofa', host: 'shop.com', startMs: 1000, endMs: 4000 }], ctx);
  assert.ok(html.includes('https://v.example.com/go/abc/p1'));
  assert.ok(html.includes('data-start="1000"') && html.includes('data-end="4000"'));
});
test('oEmbed returns a valid rich video response and respects max size', () => {
  const o = E.oembedJson(video, ctx);
  assert.equal(o.type, 'video'); assert.equal(o.version, '1.0');
  assert.ok(o.html.startsWith('<iframe') && o.html.includes('/embed/abc'));
  const small = E.oembedJson(video, ctx, 180, 1000);
  assert.equal(small.width, 180); assert.equal(small.height, 320);
  const short = E.oembedJson(video, ctx, 1000, 320);
  assert.equal(short.height, 320); assert.equal(short.width, 180);
});
test('videoIdFromUrl only accepts this deployment’s /v and /embed URLs', () => {
  assert.equal(E.videoIdFromUrl('https://v.example.com/v/abc', ctx), 'abc');
  assert.equal(E.videoIdFromUrl('https://v.example.com/embed/abc/', ctx), 'abc');
  assert.equal(E.videoIdFromUrl('https://other.com/v/abc', ctx), null);
  assert.equal(E.videoIdFromUrl('https://v.example.com/u/abc', ctx), null);
  assert.equal(E.videoIdFromUrl('nope', ctx), null);
});
test('widget script embeds the origin as a JS string literal', () => {
  assert.ok(E.widgetScript(ctx).includes('var O="https://v.example.com"'));
});

// ---- keyframes
test('keyframeTimes samples evenly inside the clip and caps the count', () => {
  assert.deepEqual(K.keyframeTimes(10, 3), [2500, 5000, 7500]);
  assert.equal(K.keyframeTimes(10, 99).length, K.MAX_KEYFRAMES);
  assert.deepEqual(K.keyframeTimes(0, 3), [0]);
  assert.equal(K.keyframeTimes(10, 0).length, 1);
});

// ---- SSRF guard + permissions catalogue
test('isPublicHttpUrl blocks loopback, private ranges and non-http', () => {
  for (const bad of ['http://localhost:4000', 'http://127.0.0.1', 'http://10.0.0.5', 'http://192.168.1.1', 'http://172.20.1.1', 'http://169.254.169.254/latest', 'http://[::1]/', 'file:///etc/passwd', 'ftp://x.com', 'x', 'http://db.internal']) {
    assert.ok(!isPublicHttpUrl(bad), bad);
  }
  assert.ok(isPublicHttpUrl('https://api.shop.com'));
  assert.ok(isPublicHttpUrl('http://172.15.0.1')); // outside 172.16–31
});
test('new permissions exist and imply view', () => {
  for (const p of ['sites.view', 'sites.edit', 'attribution.view', 'payouts.view', 'payouts.manage']) assert.ok(ALL_PERMISSIONS.includes(p), p);
  assert.deepEqual(normalizePermissions(['payouts.manage']), ['payouts.view', 'payouts.manage']);
});
