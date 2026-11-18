const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const mk = (slug, siteUrl, extra = {}) => ({ id: `id-${slug}`, name: slug, slug, siteUrl, apiUrl: '', apiType: 'link-only', country: '', currency: '', listingPath: '/listings/{id}', searchPath: '/listings?q={q}', sellPath: '', active: true, position: 0, ...extra });
const SITES = [mk('piit', 'https://piitrade.com'), mk('crafts', 'https://crafts.example.org'), mk('off', 'https://off.example.net', { active: false })];
const dbPath = path.resolve(__dirname, '../dist/db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: { site: { findMany: async () => SITES } } } };
const { resolveVideoLink } = require('../dist/lib/sites.js');

const rejects = (body, re, current) => assert.rejects(() => resolveVideoLink(body, current), (e) => e.status === 400 && re.test(e.message));

test('untouched fields leave the video alone', async () => {
  assert.equal(await resolveVideoLink({ title: 'x' }), null);
});

test('a product link on a connected site infers the site', async () => {
  const r = await resolveVideoLink({ productUrl: 'https://www.piitrade.com/listings/42#x', productTitle: '  Buy it  ' });
  assert.deepEqual(r, { siteId: 'id-piit', productUrl: 'https://www.piitrade.com/listings/42', productTitle: 'Buy it' });
});

test('a link to an unconnected domain is rejected (no linking anywhere on the internet)', async () => {
  await rejects({ productUrl: 'https://evil.example.com/x' }, /not on one of the connected sites/);
  await rejects({ productUrl: 'https://piitrade.com.evil.com/x' }, /not on one of the connected sites/);
  await rejects({ productUrl: 'javascript:alert(1)' }, /http/);
});

test('a link must belong to the chosen site (by id or slug)', async () => {
  await rejects({ siteId: 'crafts', productUrl: 'https://piitrade.com/listings/1' }, /must be a page on crafts/);
  const ok = await resolveVideoLink({ siteId: 'id-crafts', productUrl: 'https://crafts.example.org/p/9' });
  assert.equal(ok.siteId, 'id-crafts');
});

test('inactive or unknown sites cannot be chosen', async () => {
  await rejects({ siteId: 'off' }, /not available/);
  await rejects({ siteId: 'nope' }, /not available/);
});

test('a site alone is fine; clearing the link clears its title; "" clears the site', async () => {
  assert.deepEqual(await resolveVideoLink({ siteId: 'piit' }), { siteId: 'id-piit', productUrl: null, productTitle: null });
  const cur = { siteId: 'id-piit', productUrl: 'https://piitrade.com/listings/1', productTitle: 'Buy' };
  assert.deepEqual(await resolveVideoLink({ productUrl: '' }, cur), { siteId: 'id-piit', productUrl: null, productTitle: null });
  assert.deepEqual(await resolveVideoLink({ siteId: '', productUrl: '' }, cur), { siteId: null, productUrl: null, productTitle: null });
});

test('switching site while keeping an old link from another site is rejected', async () => {
  const cur = { siteId: 'id-piit', productUrl: 'https://piitrade.com/listings/1', productTitle: null };
  await rejects({ siteId: 'crafts' }, /must be a page on crafts/, cur);
});

test('a product title is capped and ignored without a link', async () => {
  const r = await resolveVideoLink({ siteId: 'piit', productUrl: 'https://piitrade.com/l/1', productTitle: 'x'.repeat(300) });
  assert.equal(r.productTitle.length, 120);
  assert.equal((await resolveVideoLink({ siteId: 'piit', productTitle: 'orphan' })).productTitle, null);
});
