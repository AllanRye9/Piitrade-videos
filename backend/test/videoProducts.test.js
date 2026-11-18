const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const mk = (slug, siteUrl) => ({ id: `id-${slug}`, name: slug, slug, siteUrl, apiUrl: '', apiType: 'link-only', country: '', currency: '', listingPath: '/listings/{id}', searchPath: '/listings?q={q}', sellPath: '', active: true, position: 0 });
const SITES = [mk('piit', 'https://piitrade.com'), mk('crafts', 'https://crafts.example.org')];
const dbPath = path.resolve(__dirname, '../dist/db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: { site: { findMany: async () => SITES } } } };
const P = require('../dist/lib/videoProducts.js');

const bad = (input, re, duration) => assert.throws(() => P.validateProducts(input, SITES, duration), (e) => re.test(e.message));

test('valid list: infers sites, trims titles, strips tracking, keeps order as position', () => {
  const out = P.validateProducts(
    [
      { url: 'https://piitrade.com/listings/1?utm_source=x', title: '  Lamp ', startMs: 1000, endMs: 4000, x: 0.25, y: 0.5 },
      { url: 'https://crafts.example.org/p/2', siteId: 'crafts' },
    ],
    SITES,
    10000
  );
  assert.equal(out[0].siteId, 'id-piit');
  assert.equal(out[0].url, 'https://piitrade.com/listings/1');
  assert.equal(out[0].title, 'Lamp');
  assert.deepEqual([out[0].startMs, out[0].endMs, out[0].x, out[0].y, out[0].position], [1000, 4000, 0.25, 0.5, 0]);
  assert.deepEqual([out[1].startMs, out[1].endMs, out[1].x, out[1].position], [0, null, null, 1]);
});

test('rejects links off the connected sites, mismatched sites and non-lists', () => {
  bad([{ url: 'https://evil.example.com/x' }], /not on one of the connected sites/);
  bad([{ url: 'https://piitrade.com/x', siteId: 'crafts' }], /must be a page on crafts/);
  bad([{ url: 'https://piitrade.com/x', siteId: 'ghost' }], /not available/);
  bad('nope', /must be a list/);
  bad([null], /invalid/);
});

test('time windows and positions are validated', () => {
  bad([{ url: 'https://piitrade.com/a', startMs: 5000, endMs: 5000 }], /after the start/);
  bad([{ url: 'https://piitrade.com/a', startMs: -1 }], /negative/);
  bad([{ url: 'https://piitrade.com/a', startMs: 20000 }], /after the video ends/, 10000);
  bad([{ url: 'https://piitrade.com/a', x: 0.5 }], /both x and y/);
  bad([{ url: 'https://piitrade.com/a', x: 2, y: 0.5 }], /between 0 and 1/);
  bad([{ url: 'https://piitrade.com/a', startMs: 'abc' }], /must be a number/);
  const capped = P.validateProducts([{ url: 'https://piitrade.com/a', startMs: 0, endMs: 99999 }], SITES, 10000);
  assert.equal(capped[0].endMs, 10000);
});

test('at most 8 products', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ url: `https://piitrade.com/${i}` }));
  bad(many, /at most 8/);
  assert.equal(P.validateProducts(many.slice(0, 8), SITES).length, 8);
});

test('mirror is the first product, or empty', () => {
  const out = P.validateProducts([{ url: 'https://piitrade.com/a', title: 'A' }, { url: 'https://piitrade.com/b' }], SITES);
  assert.deepEqual(P.mirrorOf(out), { siteId: 'id-piit', productUrl: 'https://piitrade.com/a', productTitle: 'A' });
  assert.deepEqual(P.mirrorOf([]), { siteId: null, productUrl: null, productTitle: null });
});

test('products field: arrays, JSON strings, blank, undefined, garbage', () => {
  assert.equal(P.parseProductsField(undefined), undefined);
  assert.deepEqual(P.parseProductsField(''), []);
  assert.deepEqual(P.parseProductsField('[{"url":"x"}]'), [{ url: 'x' }]);
  assert.deepEqual(P.parseProductsField([1]), [1]);
  assert.throws(() => P.parseProductsField('{oops'), (e) => e.status === 400);
  assert.throws(() => P.parseProductsField('{"a":1}'), (e) => e.status === 400);
});

test('plans: the products list wins; legacy single-link fields become one whole-video product', async () => {
  const list = await P.resolveProductPlan({ products: [{ url: 'https://piitrade.com/a' }] });
  assert.equal(list.products.length, 1);
  assert.equal(list.mirror.productUrl, 'https://piitrade.com/a');

  const legacy = await P.resolveProductPlan({ productUrl: 'https://crafts.example.org/p/9', productTitle: 'Vase' });
  assert.deepEqual([legacy.products.length, legacy.products[0].startMs, legacy.products[0].endMs, legacy.products[0].siteId], [1, 0, null, 'id-crafts']);

  const siteOnly = await P.resolveProductPlan({ siteId: 'piit' });
  assert.equal(siteOnly.products[0].url, 'https://piitrade.com/'); // a site with no page links to its home page
  assert.equal(siteOnly.mirror.productUrl, null);

  const cleared = await P.resolveProductPlan({ siteId: '', productUrl: '' });
  assert.deepEqual(cleared.products, []);

  assert.equal(await P.resolveProductPlan({ title: 'only a title' }), null);
});

test('plan errors surface as HTTP 400', async () => {
  await assert.rejects(() => P.resolveProductPlan({ products: [{ url: 'https://evil.example.com/x' }] }), (e) => e.status === 400);
  await assert.rejects(() => P.resolveProductPlan({ products: '{bad' }), (e) => e.status === 400);
});

test('fitting to the final length drops products that start after it and caps end times', () => {
  const plan = { products: P.validateProducts([{ url: 'https://piitrade.com/a', startMs: 0, endMs: 20000 }, { url: 'https://piitrade.com/b', startMs: 12000 }, { url: 'https://piitrade.com/c', startMs: 2000 }], SITES), mirror: {} };
  const fit = P.fitPlanToDuration(plan, 10000);
  assert.deepEqual(fit.products.map((p) => [p.url.slice(-1), p.endMs, p.position]), [['a', 10000, 0], ['c', null, 1]]);
  assert.equal(fit.mirror.productUrl, 'https://piitrade.com/a');
});
