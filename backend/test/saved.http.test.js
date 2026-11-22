const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const site = { id: 's1', name: 'Piitrade', active: true };
const db = { products: [], saved: [], seq: 0, raceOnCreate: false };
const key = (w) => `${w.sessionId}|${w.urlKey}`;
const fake = {
  videoProduct: {
    findFirst: async ({ where }) => { const p = db.products.find((x) => x.id === where.id && x.videoId === where.videoId); return p ? { ...p, site: p.siteActive === false ? { ...site, active: false } : site } : null; },
    findMany: async ({ where }) => db.products.filter((p) => where.videoId.in.includes(p.videoId)).map((p) => ({ ...p, site })),
  },
  savedItem: {
    findUnique: async ({ where }) => db.saved.find((s) => key(s) === key(where.sessionId_urlKey)) || null,
    count: async ({ where }) => db.saved.filter((s) => s.sessionId === where.sessionId).length,
    create: async ({ data }) => {
      if (db.raceOnCreate || db.saved.some((s) => key(s) === key(data))) {
        if (db.raceOnCreate) { db.saved.push({ id: `race${++db.seq}`, createdAt: new Date(), ...data }); db.raceOnCreate = false; }
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      }
      const row = { id: `sv${++db.seq}`, createdAt: new Date(), ...data }; db.saved.push(row); return row;
    },
    findMany: async ({ where }) => db.saved.filter((s) => s.sessionId === where.sessionId && (!where.urlKey || where.urlKey.in.includes(s.urlKey))).map((s) => ({ ...s, site, video: s.videoId ? { id: s.videoId, title: 'My video', posterFilename: 'p.jpg' } : null })),
    deleteMany: async ({ where }) => { const n = db.saved.length; db.saved = db.saved.filter((s) => !(s.id === where.id && s.sessionId === where.sessionId)); return { count: n - db.saved.length }; },
  },
};
const dbPath = require.resolve('../dist/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: fake } };

require('express-async-errors');
const express = require('express');
const savedRouter = require('../dist/routes/savedItems');
const { attachProducts } = require('../dist/lib/videoProducts');

let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/saved-items', savedRouter.default);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => {
  db.saved = []; db.raceOnCreate = false;
  db.products = [
    { id: 'p1', videoId: 'v1', siteId: 's1', url: 'https://shop.com/p/1', urlKey: 'shop.com/p/1', title: 'Leather sofa', startMs: 0, endMs: null, x: null, y: null, position: 0 },
    { id: 'p2', videoId: 'v2', siteId: 's1', url: 'https://shop.com/p/1', urlKey: 'shop.com/p/1', title: 'Same sofa, other video', startMs: 0, endMs: null, x: null, y: null, position: 0 },
    { id: 'p3', videoId: 'v1', siteId: 's1', url: 'https://shop.com/p/3', urlKey: 'shop.com/p/3', title: '', startMs: 0, endMs: null, x: null, y: null, position: 1 },
  ];
});

const call = (method, path, session = 'viewer', body) => fetch(base + '/api/saved-items' + path, { method, headers: { 'content-type': 'application/json', ...(session ? { 'x-session-id': session } : {}) }, body: body ? JSON.stringify(body) : undefined });
const save = (productId, videoId = 'v1', session = 'viewer') => call('POST', '', session, { videoId, productId });

test('tapping a product saves it; the list shows it with where it came from', async () => {
  const r = await save('p1');
  assert.equal(r.status, 201);
  assert.equal((await r.json()).count, 1);
  const list = await (await call('GET', '')).json();
  assert.equal(list.items.length, 1);
  assert.deepEqual([list.items[0].title, list.items[0].host, list.items[0].videoId, list.items[0].videoTitle], ['Leather sofa', 'shop.com', 'v1', 'My video']);
});

test('saving is idempotent, including the same product pinned in a different video', async () => {
  const a = await (await save('p1')).json();
  const again = await save('p1'); assert.equal(again.status, 200); assert.equal((await again.json()).id, a.id);
  const other = await save('p2', 'v2'); assert.equal((await other.json()).id, a.id); // same shop URL → same item
  assert.equal(db.saved.length, 1);
});

test('two simultaneous taps end with one item, not an error', async () => {
  db.raceOnCreate = true; // the "other" request inserts the row between our check and our insert
  const r = await save('p1');
  assert.equal(r.status, 201);
  assert.equal(db.saved.length, 1);
  assert.ok((await r.json()).id);
});

test('an untitled product falls back to the shop host', async () => {
  await save('p3');
  assert.equal(db.saved[0].title, 'shop.com');
});

test('lists are private per session, and you can only remove your own items', async () => {
  const mine = await (await save('p1', 'v1', 'viewer')).json();
  await save('p3', 'v1', 'someone-else');
  assert.equal((await (await call('GET', '', 'someone-else')).json()).items.length, 1);
  await call('DELETE', `/${mine.id}`, 'someone-else'); // not theirs: silently nothing
  assert.equal(db.saved.length, 2);
  assert.equal((await call('DELETE', `/${mine.id}`, 'viewer')).status, 204);
  assert.equal((await call('DELETE', `/${mine.id}`, 'viewer')).status, 204); // already gone is fine
  assert.equal(db.saved.length, 1);
});

test('bad input: unknown product, wrong video, disabled shop, missing ids, no session', async () => {
  assert.equal((await save('nope')).status, 404);
  assert.equal((await save('p1', 'v2')).status, 404); // product belongs to v1
  db.products[0].siteActive = false;
  assert.equal((await save('p1')).status, 404);
  assert.equal((await call('POST', '', 'viewer', {})).status, 400);
  assert.equal((await call('GET', '', null)).status, 400);
});

test('the list is capped at 200 with a clear message, but re-saving an existing item still works', async () => {
  for (let i = 0; i < 200; i++) db.saved.push({ id: `x${i}`, sessionId: 'viewer', urlKey: `other.com/${i}`, url: `https://other.com/${i}`, siteId: 's1', title: '', createdAt: new Date() });
  const full = await save('p3');
  assert.equal(full.status, 409);
  assert.equal((await full.json()).code, 'SAVED_FULL');
  db.saved.push({ id: 'mine', sessionId: 'viewer', urlKey: 'shop.com/p/1', url: 'https://shop.com/p/1', siteId: 's1', title: 'x', createdAt: new Date() });
  assert.equal((await save('p1')).status, 200);
});

test('feed products know what this viewer already saved (so the tag can read "Saved")', async () => {
  await save('p1');
  const mine = await attachProducts([{ id: 'v1' }, { id: 'v2' }], 'viewer');
  assert.deepEqual(mine[0].products.map((p) => [p.id, p.saved]), [['p1', true], ['p3', false]]);
  assert.equal(mine[1].products[0].saved, true); // same shop URL in another video
  const stranger = await attachProducts([{ id: 'v1' }], 'someone-else');
  assert.ok(stranger[0].products.every((p) => p.saved === false));
  const anon = await attachProducts([{ id: 'v1' }]);
  assert.ok(anon[0].products.every((p) => p.saved === false));
});
