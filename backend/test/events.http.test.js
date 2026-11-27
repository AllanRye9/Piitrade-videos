const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const G = require('../dist/lib/feed/guardrail');

const db = { videos: [], products: [], stats: [], siteStats: [], failFirstUpsert: false };
const fake = {
  video: { findMany: async ({ where }) => db.videos.filter((v) => where.id.in.includes(v.id)) },
  videoProduct: {
    groupBy: async ({ where }) => { const m = new Map(); db.products.filter((p) => where.videoId.in.includes(p.videoId)).forEach((p) => m.set(p.videoId, (m.get(p.videoId) || 0) + 1)); return [...m].map(([videoId, n]) => ({ videoId, _count: { _all: n } })); },
    findMany: async ({ where }) => db.products.filter((p) => where.id.in.includes(p.id)),
  },
  videoDailyStat: {
    upsert: async ({ where, create, update }) => {
      if (db.failFirstUpsert) { db.failFirstUpsert = false; throw Object.assign(new Error('unique'), { code: 'P2002' }); }
      const k = where.videoId_day_cohort;
      let row = db.stats.find((s) => s.videoId === k.videoId && s.cohort === k.cohort && +s.day === +k.day);
      if (!row) { row = { ...create, sumWatchMs: Number(create.sumWatchMs) }; db.stats.push(row); return row; }
      row.sessions += update.sessions.increment; row.completions += update.completions.increment;
      row.sumWatchMs += Number(update.sumWatchMs.increment); row.sumFrac += update.sumFrac.increment; row.sumFracSq += update.sumFracSq.increment;
      return row;
    },
  },
  siteDailyStat: {
    upsert: async ({ where, create, update }) => {
      const k = where.siteId_day; const row = db.siteStats.find((s) => s.siteId === k.siteId && +s.day === +k.day);
      if (!row) db.siteStats.push({ ...create }); else row.impressions += update.impressions.increment;
    },
  },
};
const dbPath = require.resolve('../dist/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: fake } };

require('express-async-errors');
const express = require('express');
const events = require('../dist/routes/events');
const { attachProducts } = require('../dist/lib/shops/videoProducts');

let server, base;
before(async () => {
  const app = express(); app.use(express.json()); app.use('/api/events', events.default);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  server = http.createServer(app); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// find one viewer in the hold-out and one outside it (hold-out is 5% by default)
let heldSession = '', exposedSession = '';
for (let i = 0; !(heldSession && exposedSession); i++) { const id = `viewer-${i}`; if (G.inHoldout(id)) heldSession ||= id; else exposedSession ||= id; }

beforeEach(() => {
  db.stats = []; db.siteStats = []; db.failFirstUpsert = false;
  db.videos = [{ id: 'tagged', duration: 10, uploaderSessionId: 'creator' }, { id: 'plain', duration: 10, uploaderSessionId: 'creator' }];
  db.products = [{ id: 'p1', videoId: 'tagged', siteId: 's1' }, { id: 'p2', videoId: 'tagged', siteId: 's2' }];
});
const send = (events, session = exposedSession) => fetch(`${base}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json', ...(session ? { 'x-session-id': session } : {}) }, body: JSON.stringify({ events }) });
const row = (videoId, cohort) => db.stats.find((s) => s.videoId === videoId && s.cohort === cohort);

test('watch events land in the right cohort and are summed per video/day', async () => {
  const r = await send([{ type: 'watch', videoId: 'tagged', watchedMs: 5000 }, { type: 'watch', videoId: 'tagged', watchedMs: 12000 }, { type: 'watch', videoId: 'plain', watchedMs: 2000 }]);
  assert.equal(r.status, 202);
  const t = row('tagged', 'exposed');
  assert.deepEqual([t.sessions, t.completions, t.sumWatchMs], [2, 1, 17000]);
  assert.ok(Math.abs(t.sumFrac - 1.5) < 1e-9 && Math.abs(t.sumFracSq - 1.25) < 1e-9);
  assert.equal(row('plain', 'untagged').sessions, 1);
  assert.equal(db.stats.length, 2);
});

test('a hold-out viewer’s watch time goes to the hold-out cohort — and their tag impressions are not counted', async () => {
  await send([{ type: 'watch', videoId: 'tagged', watchedMs: 3000 }, { type: 'chip', videoId: 'tagged', productId: 'p1' }], heldSession);
  assert.equal(row('tagged', 'holdout').sessions, 1);
  assert.equal(row('tagged', 'exposed'), undefined);
  assert.equal(db.siteStats.length, 0);
});

test('tag impressions are counted per shop, and a repeat batch adds to the same day', async () => {
  await send([{ type: 'chip', videoId: 'tagged', productId: 'p1' }, { type: 'chip', videoId: 'tagged', productId: 'p2' }, { type: 'chip', videoId: 'tagged', productId: 'p1' }]);
  await send([{ type: 'chip', videoId: 'tagged', productId: 'p1' }]);
  assert.equal(db.siteStats.find((s) => s.siteId === 's1').impressions, 3);
  assert.equal(db.siteStats.find((s) => s.siteId === 's2').impressions, 1);
  await send([{ type: 'chip', videoId: 'plain', productId: 'p1' }]); // product doesn't belong to that video
  assert.equal(db.siteStats.find((s) => s.siteId === 's1').impressions, 3);
});

test('creators’ own views, unknown videos, junk and anonymous requests are ignored without errors', async () => {
  assert.equal((await send([{ type: 'watch', videoId: 'tagged', watchedMs: 5000 }], 'creator')).status, 202);
  assert.equal((await send([{ type: 'watch', videoId: 'ghost', watchedMs: 5000 }, { type: 'watch', videoId: 'tagged', watchedMs: 'x' }, { nope: 1 }])).status, 202);
  const anon = await send([{ type: 'watch', videoId: 'tagged', watchedMs: 5000 }], null);
  assert.equal(anon.status, 202); assert.equal((await anon.json()).accepted, 0);
  assert.equal((await fetch(`${base}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-id': exposedSession }, body: '{}' })).status, 202);
  assert.equal(db.stats.length, 0);
});

test('a create/create race on the stats row is retried instead of losing the event', async () => {
  db.failFirstUpsert = true;
  const r = await send([{ type: 'watch', videoId: 'tagged', watchedMs: 4000 }]);
  assert.equal(r.status, 202);
  assert.equal(row('tagged', 'exposed').sessions, 1);
});

test('feed products are withheld from hold-out viewers (except creators), shown to everyone else', async () => {
  db.products = db.products.map((p) => ({ ...p, videoId: 'tagged', url: 'https://shop.com/' + p.id, urlKey: 'shop.com/' + p.id, title: '', startMs: 0, endMs: null, x: null, y: null, position: 0, site: { name: 'S' } }));
  fake.videoProduct.findMany = async ({ where }) => db.products.filter((p) => (where.videoId ? where.videoId.in.includes(p.videoId) : where.id.in.includes(p.id)));
  fake.savedItem = { findMany: async () => [] };
  const held = await attachProducts([{ id: 'tagged' }], heldSession);
  assert.equal(held[0].products.length, 0);
  const owner = await attachProducts([{ id: 'tagged', uploader: { isOwn: true } }], heldSession);
  assert.equal(owner[0].products.length, 2);
  const normal = await attachProducts([{ id: 'tagged' }], exposedSession);
  assert.equal(normal[0].products.length, 2);
  assert.equal((await attachProducts([{ id: 'tagged' }]))[0].products.length, 2); // anonymous/web: never held out
});
