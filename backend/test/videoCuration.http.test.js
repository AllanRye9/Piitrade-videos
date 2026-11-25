const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let rows;
const mk = (id, t, extra = {}) => ({ id, title: id, description: '', filename: id + '.mp4', posterFilename: null, mimeType: 'video/mp4', size: 1, duration: 5, likes: 0, views: 0, comments: 0, shares: 0, hashtags: [], uploaderSessionId: null, locationId: null, hidden: false, hiddenAt: null, pinRank: null, createdAt: new Date(2025, 0, t), ...extra });
const match = (r, w = {}) => Object.entries(w).every(([k, v]) => {
  if (k === 'OR' || k === 'AND') return true; // cursor clause: tests use the first page
  if (v && typeof v === 'object' && 'not' in v) return r[k] !== v.not;
  if (v && typeof v === 'object' && 'in' in v) return v.in.includes(r[k]);
  return r[k] === v;
});
const sortBy = (list, ob) => {
  const o = Array.isArray(ob) ? ob : [ob];
  return [...list].sort((a, b) => { for (const c of o) { const [k, d] = Object.entries(c)[0]; const x = a[k], y = b[k]; if (x === y) continue; const r = x > y ? 1 : -1; return d === 'desc' ? -r : r; } return 0; });
};
const empty = async () => [];
const fake = {
  auditLog: { create: async () => ({}) },
  video: {
    findMany: async ({ where, orderBy, take }) => { let l = rows.filter((r) => match(r, where)); if (orderBy) l = sortBy(l, orderBy); return take ? l.slice(0, take) : l; },
    findUnique: async ({ where }) => rows.find((r) => r.id === where.id) ?? null,
    count: async ({ where }) => rows.filter((r) => match(r, where)).length,
    update: async ({ where, data }) => { const r = rows.find((x) => x.id === where.id); Object.assign(r, data); return r; },
  },
  userVideoState: { findMany: empty }, sessionProfile: { findMany: empty }, follow: { findMany: empty },
  videoProduct: { findMany: empty }, report: { groupBy: empty, findMany: empty }, location: { findMany: empty },
  site: { findMany: empty },
};
const mock = (p, exports) => { const f = require.resolve(p); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
mock('../dist/db', { prisma: fake });
mock('../dist/middleware/requireAdmin', { requireAdmin: (_q, _s, n) => n(), requirePermission: () => (_q, _s, n) => n(), requirePrimary: (_q, _s, n) => n() });
mock('../dist/middleware/rateLimit', new Proxy({}, { get: () => (_q, _s, n) => n() }));

require('express-async-errors');
const express = require('express');
const adminVideos = require('../dist/routes/admin/videos').default;
const publicVideos = require('../dist/routes/videos').default;

let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/videos', (req, _s, n) => { req.admin = { email: 'a@x.co' }; n(); }, adminVideos);
  app.use('/api/videos', publicVideos);
  app.use((err, _q, res, _n) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => { rows = [mk('a', 1), mk('b', 2), mk('c', 3), mk('d', 4)]; });

const send = (m, p, body) => fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const feed = async () => (await (await fetch(base + '/api/videos')).json()).videos.map((v) => v.id);

test('hide removes a video from the feed and permalink; unhide restores it', async () => {
  assert.deepEqual(await feed(), ['d', 'c', 'b', 'a']);
  assert.equal((await send('POST', '/api/admin/videos/c/hide')).status, 200);
  assert.deepEqual(await feed(), ['d', 'b', 'a']);
  assert.equal((await fetch(base + '/api/videos/c')).status, 404);
  assert.equal((await send('POST', '/api/admin/videos/c/unhide')).status, 200);
  assert.deepEqual(await feed(), ['d', 'c', 'b', 'a']);
});

test('pinned videos lead the feed in pin order; reorder and unpin work', async () => {
  await send('PUT', '/api/admin/videos/a/pin', { pinned: true });
  await send('PUT', '/api/admin/videos/b/pin', { pinned: true });
  assert.deepEqual(await feed(), ['a', 'b', 'd', 'c']);
  assert.equal((await send('PUT', '/api/admin/videos/pins/order', { ids: ['b', 'a'] })).status, 200);
  assert.deepEqual(await feed(), ['b', 'a', 'd', 'c']);
  assert.equal((await send('PUT', '/api/admin/videos/pins/order', { ids: ['b'] })).status, 400);
  await send('PUT', '/api/admin/videos/b/pin', { pinned: false });
  assert.deepEqual(await feed(), ['a', 'd', 'c', 'b']);
});

test('hiding drops the pin, and a hidden video cannot be pinned', async () => {
  await send('PUT', '/api/admin/videos/a/pin', { pinned: true });
  await send('POST', '/api/admin/videos/a/hide');
  assert.equal(rows.find((r) => r.id === 'a').pinRank, null);
  const r = await send('PUT', '/api/admin/videos/a/pin', { pinned: true });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'VIDEO_HIDDEN');
});

test('admin list filters by status and shows flags', async () => {
  await send('POST', '/api/admin/videos/b/hide');
  await send('PUT', '/api/admin/videos/d/pin', { pinned: true });
  const list = async (s) => (await (await fetch(`${base}/api/admin/videos?status=${s}`)).json()).videos;
  assert.deepEqual((await list('hidden')).map((v) => v.id), ['b']);
  assert.deepEqual((await list('pinned')).map((v) => [v.id, v.pinRank]), [['d', 0]]);
  assert.equal((await list('visible')).length, 3);
});

test('search and trending exclude hidden videos', async () => {
  await send('POST', '/api/admin/videos/a/hide');
  const s = await (await fetch(base + '/api/videos/search?q=a')).json();
  assert.ok(!s.videos.some((v) => v.id === 'a'));
});
