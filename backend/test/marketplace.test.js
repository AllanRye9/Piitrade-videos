// Regression tests for backend/src/lib/marketplace.ts's search fallback
// ladder and the GET /api/marketplace/search route.
//
// WHY THIS FILE EXISTS: the real marketplace backend does a verbatim,
// case-insensitive SUBSTRING match of the entire query string against
// title/description (confirmed directly against its route source —
// Prisma `contains: q, mode: 'insensitive'`). A multi-word AI-generated
// identification ("Vintage Wooden Dining Chair with Carved Legs") will
// almost never appear verbatim inside a real listing's title ("Wooden
// Dining Chair") — so searching with the raw text returns 0 results
// even when a genuinely matching item exists. searchProductsWithFallback
// exists specifically to compensate for that. A first attempt at this
// (a prefix-only ladder: first 7 words, first 5, ...) still FAILED this
// exact case, because "Vintage" leads every prefix candidate and the
// real title has no "Vintage" in it — every candidate still contained
// that leading word. This test file exists so that regression can never
// silently return.
//
// Run with: npm test  (after `npm run build` — this requires dist/).
// Uses Node's built-in test runner (node:test) — no new dependency.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// db.ts calls `new PrismaClient()` at module load time, which throws in
// any environment where `prisma generate` hasn't produced a real client
// (e.g. this sandbox, where the engine binary download is network-
// blocked). Nothing under test here touches the database, so it's
// stubbed out rather than requiring a real Postgres + generated client
// just to run these tests.
const dbPath = path.resolve(__dirname, '../dist/db.js');
// Sites are admin-managed rows; the tests control which exist via SITES.
const mk = (over) => ({ id: over.slug, name: over.slug, siteUrl: `https://${over.slug}.example`, apiUrl: '', apiType: 'piitrade', country: '', currency: 'UGX', listingPath: '/listings/{id}', searchPath: '/listings?q={q}', sellPath: '', active: true, position: 0, ...over });
const SITE = mk({ slug: 'shop-one', name: 'Shop One', apiUrl: 'https://fake-marketplace.test' });
let SITES = [SITE];
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: { site: { findMany: async () => SITES } } } };

const FAKE_CATALOG = [
  {
    id: '1',
    title: 'Wooden Dining Chair',
    description: 'Solid oak, seats 4',
    price: 150000,
    currency: 'UGX',
    stock: 2,
    status: 'ACTIVE',
    productImages: [{ cdnUrl: 'https://cdn.example/chair1.jpg' }],
    user: { id: 'seller-1' },
  },
  {
    id: '2',
    title: 'Office Chair - Used',
    description: 'Ergonomic mesh back',
    price: 80000,
    currency: 'UGX',
    stock: 1,
    status: 'ACTIVE',
    productImages: [{ cdnUrl: 'https://cdn.example/chair2.jpg' }],
    user: { id: 'seller-2' },
  },
  {
    id: '3',
    title: 'Samsung Galaxy Charger',
    description: 'Fast charging, 25W, original',
    price: 35000,
    currency: 'UGX',
    stock: 3,
    status: 'ACTIVE',
    productImages: [],
    user: { id: 'seller-4' },
  },
  {
    // Deliberately shares the word "Wooden" with item '1' but is a
    // different, irrelevant item — used to prove the multi-word tier's
    // precision benefit (see the "prefers a precise multi-word match" test).
    id: '4',
    title: 'Wooden Toy Box',
    description: 'Storage box for kids toys',
    price: 45000,
    currency: 'UGX',
    stock: 4,
    status: 'ACTIVE',
    productImages: [],
    user: { id: 'seller-5' },
  },
  {
    // A sold ad — must never be shown as a lead from a video.
    id: '5',
    title: 'Sold Leather Sofa',
    description: 'Three seater',
    price: 900000,
    currency: 'UGX',
    status: 'SOLD',
    productImages: [],
    user: { id: 'seller-6' },
  },
  {
    // Exercises the optional enrichment fields and a price drop.
    id: '6',
    title: 'Trek Mountain Bike',
    description: 'Barely used',
    price: 700000,
    originalPrice: 900000,
    currency: 'UGX',
    status: 'ACTIVE',
    condition: 'LIKE_NEW',
    location: 'Kampala',
    productImages: [],
    user: { id: 'seller-7', name: 'Amina K', isVerified: true },
  },
];

// Fakes the real marketplace's confirmed search behavior: verbatim
// case-insensitive substring match against title/description, nothing
// smarter. Only intercepts calls to the fake host — anything else
// (including this test's own calls to its local Express server) goes
// through the real fetch, or every HTTP request in the test process
// would be swallowed by this mock.
const realFetch = global.fetch;
global.fetch = async (url, init) => {
  const u = new URL(url);
  if (u.hostname === 'fake-second.test') {
    // A second marketplace with one item, to prove results from several sites are merged.
    return { ok: true, status: 200, headers: { getSetCookie: () => [] }, json: async () => ({ listings: [{ id: 'b1', title: 'Wooden Dining Chair (second shop)', description: '', price: 99, currency: 'USD', status: 'ACTIVE', productImages: [] }] }) };
  }
  if (u.hostname === 'fake-broken.test') return { ok: false, status: 500, headers: { getSetCookie: () => [] }, json: async () => ({ message: 'boom' }) };
  if (u.hostname !== 'fake-marketplace.test') return realFetch(url, init);
  const q = (u.searchParams.get('q') || '').toLowerCase();
  const listings = FAKE_CATALOG.filter((l) => l.title.toLowerCase().includes(q) || l.description.toLowerCase().includes(q));
  return { ok: true, status: 200, headers: { getSetCookie: () => [] }, json: async () => ({ listings, pagination: {} }) };
};

const { searchProductsWithFallback, searchSites } = require('../dist/lib/marketplace.js');
const { invalidateSites } = require('../dist/lib/sites.js');
const useSites = (list) => { SITES = list; invalidateSites(); };

test('finds the real listing when the AI text leads with a word not in the title (the bug that was fixed)', async () => {
  const outcome = await searchProductsWithFallback(SITE, 'Vintage Wooden Dining Chair with Carved Legs');
  assert.ok(outcome.results.some((r) => r.id === '1'), 'expected the Wooden Dining Chair listing to be found');
  assert.ok(outcome.matchedQuery && outcome.matchedQuery.length < 'Vintage Wooden Dining Chair with Carved Legs'.length);
});

test('finds the real listing when the AI text trails with words not in the title', async () => {
  const outcome = await searchProductsWithFallback(SITE, 'Genuine Samsung Galaxy Charger Adapter Brand New');
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].id, '3');
});

test('an already-close query matches on the first attempt (no unnecessary fallback)', async () => {
  const outcome = await searchProductsWithFallback(SITE, 'Office Chair');
  assert.equal(outcome.attempts.length, 1);
  assert.equal(outcome.results[0].id, '2');
});

test('a genuinely nonexistent item exhausts the ladder and returns empty, not an error', async () => {
  const outcome = await searchProductsWithFallback(SITE, 'Antique Grandfather Clock Mahogany');
  assert.equal(outcome.results.length, 0);
  assert.equal(outcome.matchedQuery, null);
  assert.ok(outcome.attempts.length > 1);
  assert.ok(outcome.attempts.length <= 10, 'ladder must stay capped, not grow unbounded');
});

test('a single-word query does not produce redundant duplicate attempts', async () => {
  const outcome = await searchProductsWithFallback(SITE, 'Chair');
  assert.equal(outcome.attempts.length, 1);
});

// This is the test that actually justifies the prefix/suffix tier
// existing at all (as opposed to just falling straight to individual
// words). If a multi-word phrase is a substring of a title, each of
// its individual words trivially is too — so removing the
// prefix/suffix tier can never cause a genuine match to be missed
// entirely (verified: deliberately disabling it here still passed
// every other test in this file). What it actually buys is PRECISION:
// preferring a specific multi-word match over a broad single-word one
// that would also pull in unrelated items sharing that one word.
test('prefers a precise multi-word match over a noisier single-word one when both would match', async () => {
  const outcome = await searchProductsWithFallback(SITE, 'Rustic Wooden Dining Chair');
  const ids = outcome.results.map((r) => r.id).sort();
  // "Wooden Dining Chair" (id '1') is the correct, specific match via
  // the suffix tier. Falling straight to the single word "Wooden"
  // would ALSO have matched a second, irrelevant item — proving the
  // multi-word tier's precision benefit rather than just "any match".
  assert.deepEqual(ids, ['1']);
  assert.equal(outcome.matchedQuery, 'Wooden Dining Chair');
});

test('sold/inactive listings are never returned', async () => {
  const outcome = await searchProductsWithFallback(SITE, 'Leather Sofa');
  assert.equal(outcome.results.length, 0);
});

test('optional listing details are mapped when present and a price drop shows the original price', async () => {
  const outcome = await searchProductsWithFallback(SITE, 'Mountain Bike');
  assert.equal(outcome.results.length, 1);
  const r = outcome.results[0];
  assert.equal(r.price, 'UGX 700,000');
  assert.equal(r.originalPrice, 'UGX 900,000');
  assert.equal(r.condition, 'Like new');
  assert.equal(r.location, 'Kampala');
  assert.equal(r.sellerName, 'Amina K');
  assert.equal(r.verifiedSeller, true);
});

test('a listing with none of the optional fields still maps cleanly', async () => {
  const outcome = await searchProductsWithFallback(SITE, 'Office Chair');
  const r = outcome.results[0];
  assert.equal(r.location, undefined);
  assert.equal(r.condition, undefined);
  assert.equal(r.originalPrice, undefined);
  assert.equal(r.price, 'UGX 80,000');
});

test('bare stopwords are never tried as their own candidate', async () => {
  const outcome = await searchProductsWithFallback(SITE, 'a chair with the legs');
  const triedBareStopword = outcome.attempts.some((a) => ['a', 'with', 'the'].includes(a.query.toLowerCase()));
  assert.equal(triedBareStopword, false);
});

// --- HTTP-level tests for GET /api/marketplace/search ---

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

test('GET /api/marketplace/search with no q returns HTTP 400', async () => {
  const res = await realFetch(`${base}/api/marketplace/search`);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.ok(typeof body.error === 'string' && body.error.length > 0);
});

test('GET /api/marketplace/search with blank q returns HTTP 400', async () => {
  const res = await realFetch(`${base}/api/marketplace/search?q=`);
  assert.equal(res.status, 400);
});

test('GET /api/marketplace/search with a matching (but shortened-needed) query returns HTTP 200 with the right shape', async () => {
  const res = await realFetch(`${base}/api/marketplace/search?q=${encodeURIComponent('Genuine Samsung Galaxy Charger Adapter Brand New')}`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(body.results));
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].id, '3');
  assert.equal(body.results[0].name, 'Samsung Galaxy Charger');
  assert.equal(body.results[0].price, 'UGX 35,000');
  // Every result must open the listing on ITS site (no cart/checkout) and
  // carry the "see all" link — built from the admin-managed site, not a constant.
  assert.match(body.results[0].listingUrl, /^https:\/\/shop-one\.example\/listings\/3\?/);
  assert.match(body.results[0].listingUrl, /utm_source=piitrade_videos/);
  assert.deepEqual(body.results[0].site, { slug: 'shop-one', name: 'Shop One' });
  assert.match(body.browseUrl, /^https:\/\/shop-one\.example\/listings\?q=/);
  assert.notEqual(body.matchedQuery, 'Genuine Samsung Galaxy Charger Adapter Brand New');
});

test('GET /api/marketplace/search with a true miss returns HTTP 200 with empty results (not an error)', async () => {
  const res = await realFetch(`${base}/api/marketplace/search?q=${encodeURIComponent('Completely Nonexistent Item Xyz')}`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.results, []);
  assert.equal(body.matchedQuery, null);
});

test('the old cart/checkout/account routes no longer exist (piitrade.com is a classifieds site)', async () => {
  for (const [method, route] of [
    ['POST', '/api/marketplace/checkout'],
    ['POST', '/api/marketplace/login'],
    ['POST', '/api/marketplace/register'],
    ['GET', '/api/marketplace/account'],
    ['DELETE', '/api/marketplace/account'],
  ]) {
    const res = await realFetch(`${base}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' });
    assert.equal(res.status, 404, `${method} ${route} should be gone`);
  }
});

test('an unknown path under the marketplace router returns HTTP 404', async () => {
  const res = await realFetch(`${base}/api/marketplace/does-not-exist`);
  assert.equal(res.status, 404);
});

// --- multiple sites ---

test('searchSites merges results from every site, each tagged with and linked to its own site', async () => {
  const two = mk({ slug: 'shop-two', name: 'Shop Two', siteUrl: 'https://two.example', apiUrl: 'https://fake-second.test', currency: 'USD', listingPath: '/p/{id}' });
  useSites([SITE, two]);
  const out = await searchSites('Wooden Dining Chair');
  const bySite = Object.fromEntries(out.results.map((r) => [r.site.slug, r]));
  assert.equal(bySite['shop-one'].id, '1');
  assert.match(bySite['shop-one'].listingUrl, /^https:\/\/shop-one\.example\/listings\/1\?/);
  assert.equal(bySite['shop-two'].id, 'b1');
  assert.match(bySite['shop-two'].listingUrl, /^https:\/\/two\.example\/p\/b1\?/);
  assert.equal(bySite['shop-two'].price, 'USD 99');
  assert.deepEqual(out.sites.map((s) => [s.slug, s.count]), [['shop-one', 1], ['shop-two', 1]]);
  assert.equal(out.results[0].site.slug, 'shop-one', 'round-robin: first site first');
});

test('a broken site does not break the others, and a link-only site contributes just its browse link', async () => {
  const broken = mk({ slug: 'broken', apiUrl: 'https://fake-broken.test' });
  const linkOnly = mk({ slug: 'plain', name: 'Plain Shop', apiType: 'link-only', siteUrl: 'https://plain.example', searchPath: '/s?term={q}' });
  useSites([SITE, broken, linkOnly]);
  const out = await searchSites('Office Chair');
  assert.equal(out.results.length, 1);
  const summary = Object.fromEntries(out.sites.map((s) => [s.slug, s]));
  assert.equal(summary.broken.error, 'boom');
  assert.equal(summary.broken.count, 0);
  assert.equal(summary.plain.linkOnly, true);
  assert.match(summary.plain.browseUrl, /^https:\/\/plain\.example\/s\?term=Office\+Chair/);
});

test('searching one site by slug, inactive sites, and "no sites yet"', async () => {
  const two = mk({ slug: 'shop-two', siteUrl: 'https://two.example', apiUrl: 'https://fake-second.test' });
  useSites([SITE, two, mk({ slug: 'off', apiUrl: 'https://fake-marketplace.test', active: false })]);
  const only = await searchSites('Wooden Dining Chair', 'shop-two');
  assert.deepEqual(only.sites.map((s) => s.slug), ['shop-two']);
  const all = await searchSites('Wooden Dining Chair');
  assert.ok(!all.sites.some((s) => s.slug === 'off'), 'inactive sites are never searched');
  useSites([]);
  await assert.rejects(() => searchSites('anything'), /No sites are connected/);
  useSites([SITE]);
});

test('GET /api/marketplace/sites lists active sites with ready-made links', async () => {
  useSites([mk({ slug: 'shop-one', name: 'Shop One', apiUrl: 'https://fake-marketplace.test', sellPath: '/sell' }), mk({ slug: 'off', active: false })]);
  const res = await realFetch(`${base}/api/marketplace/sites`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.sites.length, 1);
  assert.equal(body.sites[0].slug, 'shop-one');
  assert.match(body.sites[0].sellUrl, /^https:\/\/shop-one\.example\/sell\?/);
  assert.equal(body.sites[0].searchable, true);
  useSites([SITE]);
});
