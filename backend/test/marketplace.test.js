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
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: {} } };

// CAUTION when adding fixtures: this is a substring-match simulation,
// so a word appearing in one item's title/description can silently
// satisfy a DIFFERENT test's query and match the wrong item (this has
// already happened twice while writing this file — "Wooden" and
// "Genuine" each accidentally appeared in two fixtures). Check new
// title/description text against every existing fixture before adding it.
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
    // Has multiple images, in a deliberately non-alphabetical order —
    // used to confirm ALL images are collected, in the order given,
    // not just the first.
    id: '5',
    title: 'Leather Sofa Three Seater',
    description: 'Real leather, brown, minor wear',
    price: 900000,
    currency: 'UGX',
    stock: 1,
    status: 'ACTIVE',
    productImages: [
      { cdnUrl: 'https://cdn.example/sofa-front.jpg' },
      { cdnUrl: 'https://cdn.example/sofa-side.jpg' },
      { cdnUrl: 'https://cdn.example/sofa-back.jpg' },
    ],
    user: { id: 'seller-6' },
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
  if (u.hostname !== 'fake-marketplace.test') return realFetch(url, init);
  const q = (u.searchParams.get('q') || '').toLowerCase();
  const listings = FAKE_CATALOG.filter((l) => l.title.toLowerCase().includes(q) || l.description.toLowerCase().includes(q));
  return { ok: true, status: 200, headers: { getSetCookie: () => [] }, json: async () => ({ listings, pagination: {} }) };
};
process.env.MARKETPLACE_API = 'https://fake-marketplace.test';

const { searchProductsWithFallback } = require('../dist/lib/marketplace.js');

test('finds the real listing when the AI text leads with a word not in the title (the bug that was fixed)', async () => {
  const outcome = await searchProductsWithFallback('Vintage Wooden Dining Chair with Carved Legs');
  assert.ok(outcome.results.some((r) => r.id === '1'), 'expected the Wooden Dining Chair listing to be found');
  assert.ok(outcome.matchedQuery && outcome.matchedQuery.length < 'Vintage Wooden Dining Chair with Carved Legs'.length);
});

test('collects ALL of a listing\'s images, in order — not just the first', async () => {
  const outcome = await searchProductsWithFallback('Leather Sofa Three Seater');
  const sofa = outcome.results.find((r) => r.id === '5');
  assert.ok(sofa, 'expected the sofa listing to be found');
  assert.equal(sofa.image, 'https://cdn.example/sofa-front.jpg', 'single `image` should be the first one');
  assert.deepEqual(sofa.images, [
    'https://cdn.example/sofa-front.jpg',
    'https://cdn.example/sofa-side.jpg',
    'https://cdn.example/sofa-back.jpg',
  ]);
});

test('a listing with no images at all gets an empty images array, not a crash', async () => {
  const outcome = await searchProductsWithFallback('Wooden Toy Box');
  const toyBox = outcome.results.find((r) => r.id === '4');
  assert.ok(toyBox, 'expected the toy box listing to be found');
  assert.equal(toyBox.image, '');
  assert.deepEqual(toyBox.images, []);
});

test('finds the real listing when the AI text trails with words not in the title', async () => {
  const outcome = await searchProductsWithFallback('Genuine Samsung Galaxy Charger Adapter Brand New');
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].id, '3');
});

test('an already-close query matches on the first attempt (no unnecessary fallback)', async () => {
  const outcome = await searchProductsWithFallback('Office Chair');
  assert.equal(outcome.attempts.length, 1);
  assert.equal(outcome.results[0].id, '2');
});

test('a genuinely nonexistent item exhausts the ladder and returns empty, not an error', async () => {
  const outcome = await searchProductsWithFallback('Antique Grandfather Clock Mahogany');
  assert.equal(outcome.results.length, 0);
  assert.equal(outcome.matchedQuery, null);
  assert.ok(outcome.attempts.length > 1);
  assert.ok(outcome.attempts.length <= 10, 'ladder must stay capped, not grow unbounded');
});

test('a single-word query does not produce redundant duplicate attempts', async () => {
  const outcome = await searchProductsWithFallback('Chair');
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
  const outcome = await searchProductsWithFallback('Rustic Wooden Dining Chair');
  const ids = outcome.results.map((r) => r.id).sort();
  // "Wooden Dining Chair" (id '1') is the correct, specific match via
  // the suffix tier. Falling straight to the single word "Wooden"
  // would ALSO have matched a second, irrelevant item — proving the
  // multi-word tier's precision benefit rather than just "any match".
  assert.deepEqual(ids, ['1']);
  assert.equal(outcome.matchedQuery, 'Wooden Dining Chair');
});

test('bare stopwords are never tried as their own candidate', async () => {
  const outcome = await searchProductsWithFallback('a chair with the legs');
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
  assert.equal(body.results[0].price, '35000 UGX');
  assert.equal(typeof body.results[0].match, 'number');
  assert.notEqual(body.matchedQuery, 'Genuine Samsung Galaxy Charger Adapter Brand New');
});

test('GET /api/marketplace/search with a true miss returns HTTP 200 with empty results (not an error)', async () => {
  const res = await realFetch(`${base}/api/marketplace/search?q=${encodeURIComponent('Completely Nonexistent Item Xyz')}`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.results, []);
  assert.equal(body.matchedQuery, null);
});

test('an unknown path under the marketplace router returns HTTP 404', async () => {
  const res = await realFetch(`${base}/api/marketplace/does-not-exist`);
  assert.equal(res.status, 404);
});
