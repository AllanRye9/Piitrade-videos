// POST /api/frame-search end to end: a real frame is cut from a real stored video; the AI and the shops are stubbed.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const haveFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-http-'));
process.env.UPLOAD_DIR = root;
process.env.AI_SEARCH = 'http://ai.invalid';
fs.mkdirSync(path.join(root, 'videos'), { recursive: true });

let identifyCalls;
let identifyImpl;
let searchImpl;
const product = (name) => ({ id: name, name, price: 'UGX 5,000', originalPrice: null, image: 'x.jpg', description: '', listingUrl: 'https://p/' + name, location: 'Kampala', condition: 'new', sellerName: 's', storeName: 'st', verifiedSeller: true, featured: false, shop: { id: 'piitrade', name: 'Piitrade' } });
const videos = { v1: { id: 'v1', title: 'Fresh produce', hashtags: ['#tomatoes'], filename: 'v1.mp4', duration: 4 }, v2: { id: 'v2', title: 'Untitled', hashtags: [], filename: 'missing.mp4', duration: 4 } };
const mock = (p, exports) => { const f = require.resolve(p); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
mock('../dist/db', { prisma: { video: { findUnique: async ({ where }) => videos[where.id] ?? null } } });
mock('../dist/middleware/rateLimit', new Proxy({}, { get: () => (_q, _s, n) => n() }));
mock('../dist/lib/search/aiSearch', { identifyImage: async (buf, mime) => { identifyCalls.push(buf.length); return { text: await identifyImpl(identifyCalls.length) }; } });
mock('../dist/lib/search/searchSites', { searchConfigured: async () => true, searchSites: async (q) => searchImpl(q) });

require('express-async-errors');
const express = require('express');
let server, base;
before(async () => {
  if (!haveFfmpeg) return;
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=540x960:rate=25:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(root, 'videos', 'v1.mp4')]);
  const app = express();
  app.use(express.json());
  app.use('/api/frame-search', require('../dist/routes/frameSearch').default);
  app.use((err, _q, res, _n) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); fs.rmSync(root, { recursive: true, force: true }); });
beforeEach(() => {
  identifyCalls = [];
  identifyImpl = async () => 'red tomatoes';
  searchImpl = async (q) => ({ results: [product(q)], matchedQuery: q, searched: [{ id: 'piitrade', name: 'Piitrade', count: 1 }], failed: [] });
});
const post = (body) => fetch(base + '/api/frame-search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('the frame at the viewer position is read by the AI and its description is searched', { skip: !haveFfmpeg }, async () => {
  const res = await post({ videoId: 'v1', atMs: 1500 });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.source, 'frame');
  assert.equal(j.identification, 'red tomatoes');
  assert.equal(j.results[0].name, 'red tomatoes');
  assert.match(j.frame, /^data:image\/jpeg;base64,/);
  assert.equal(j.atMs, 1500);
  assert.equal(j.attempts.length, 1);
  assert.equal(identifyCalls.length, 1);
});

test('when the AI fails once, another moment of the video is tried', { skip: !haveFfmpeg }, async () => {
  identifyImpl = async (n) => { if (n === 1) throw new Error('timeout'); return 'blue shirt'; };
  const j = await (await post({ videoId: 'v1', atMs: 2000 })).json();
  assert.equal(j.source, 'frame');
  assert.equal(j.identification, 'blue shirt');
  assert.equal(j.attempts.length, 2);
  assert.equal(j.attempts[0].stopped, 'identify-failed');
  assert.notEqual(j.atMs, 2000);
});

test('a marked region is cropped before the AI sees it (smaller image)', { skip: !haveFfmpeg }, async () => {
  await post({ videoId: 'v1', atMs: 1000 });
  await post({ videoId: 'v1', atMs: 1000, region: { x: 0.25, y: 0.25, w: 0.5, h: 0.25 } });
  assert.ok(identifyCalls[1] < identifyCalls[0], `${identifyCalls[1]} should be smaller than ${identifyCalls[0]}`);
});

test('nothing listed for what the frames show: falls back to the video title and says so', { skip: !haveFfmpeg }, async () => {
  searchImpl = async (q) => (q === 'tomatoes' ? { results: [product('tomatoes')], matchedQuery: 'tomatoes', searched: [], failed: [] } : { results: [], matchedQuery: null, searched: [], failed: [] });
  const j = await (await post({ videoId: 'v1', atMs: 1000 })).json();
  assert.equal(j.source, 'title');
  assert.equal(j.query, 'tomatoes');
  assert.equal(j.identification, 'red tomatoes');
  assert.match(j.note, /isn.t listed/);
  assert.equal(j.results.length, 1);
  assert.equal(identifyCalls.length, 3); // bounded: three frames, then the title
});

test('input is validated and unknown videos are 404', { skip: !haveFfmpeg }, async () => {
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ videoId: 'v1', atMs: -5 })).status, 400);
  assert.equal((await post({ videoId: 'v1', atMs: 'x' })).status, 400);
  assert.equal((await post({ videoId: 'v1', atMs: 0, region: { x: 0.9, y: 0, w: 0.5, h: 0.5 } })).status, 400);
  assert.equal((await post({ videoId: 'nope', atMs: 0 })).status, 404);
});

test('a video file that cannot be read gives a clear 422 instead of a hang', { skip: !haveFfmpeg }, async () => {
  const res = await post({ videoId: 'v2', atMs: 0 });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).code, 'FRAME_UNAVAILABLE');
});
