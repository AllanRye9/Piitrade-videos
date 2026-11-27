// POST /api/videos end to end with real ffmpeg: the frame standard and the editor's `edits` field.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const haveFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-http-'));
process.env.UPLOAD_DIR = root;
// The server creates these at startup (index.ts); the test does the same.
for (const d of ['videos', 'posters', 'products']) fs.mkdirSync(path.join(root, d), { recursive: true });

const created = [];
const model = new Proxy({}, { get: (_t, m) => async () => (m === 'findMany' ? [] : null) });
const fake = new Proxy({}, { get: (_t, name) => (name === 'sessionProfile'
  ? { findUnique: async () => ({ userId: 'u1', user: { suspendedAt: null } }), findMany: async () => [], upsert: async () => ({ handle: 'h' }), update: async () => ({}), create: async () => ({}) }
  : name === 'video'
    ? { create: async ({ data }) => { const row = { id: 'v' + (created.length + 1), likes: 0, views: 0, comments: 0, shares: 0, createdAt: new Date(), hidden: false, ...data }; created.push(row); return row; }, findUnique: async () => null, findMany: async () => [] }
    : model) });
const mock = (p, exports) => { const f = require.resolve(p); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
mock('../dist/db', { prisma: fake });
mock('../dist/middleware/rateLimit', new Proxy({}, { get: () => (_q, _s, n) => n() }));
mock('../dist/lib/core/r2', { uploadToR2: async () => null, isR2Configured: () => false, r2PublicUrl: () => null });

require('express-async-errors');
const express = require('express');
let server, base;
before(async () => {
  if (!haveFfmpeg) return;
  const router = require('../dist/routes/videos').default;
  const app = express();
  app.use(express.json());
  app.use('/api/videos', router);
  app.use((err, _q, res, _n) => { if (!err.status) console.error('UNEXPECTED', err.stack); res.status(err.status || 500).json({ error: err.message, code: err.code, details: err.details }); });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); fs.rmSync(root, { recursive: true, force: true }); });

function gen(name, size, secs, rate = 30) {
  const out = path.join(root, name);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${rate}:duration=${secs}`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=' + secs, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out]);
  return out;
}
async function upload(file, fields = {}) {
  const form = new FormData();
  form.append('title', 'Clip');
  form.append('description', '');
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('video', new Blob([fs.readFileSync(file)], { type: 'video/mp4' }), path.basename(file));
  return fetch(base + '/api/videos', { method: 'POST', headers: { 'X-Session-Id': 's1' }, body: form });
}
const stored = (row) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path.join(root, 'videos', row.filename)]).toString());
const dims = (j) => { const v = j.streams.find((s) => s.codec_type === 'video'); return [v.width, v.height]; };

test('a 4K upload is stored at 1080p (the frame standard), sound kept', { skip: !haveFfmpeg }, async () => {
  const src = gen('big4k.mp4', '3840x2160', 2, 60);
  const res = await upload(src);
  assert.equal(res.status, 201, await res.clone().text());
  const row = created[created.length - 1];
  const j = stored(row);
  assert.deepEqual(dims(j), [1920, 1080]);
  assert.ok(j.streams.some((s) => s.codec_type === 'audio'));
  assert.ok(Math.abs(row.duration - 2) < 0.2);
});

test('edits: cut a middle part, double the speed, rotate — stored length and shape follow', { skip: !haveFfmpeg }, async () => {
  const src = gen('src.mp4', '640x360', 8, 25);
  const edits = { segments: [{ start: 0, end: 2 }, { start: 4, end: 8 }], speed: 2, rotate: 90, look: { preset: 'mono' }, fadeOut: 0.5 };
  const res = await upload(src, { edits: JSON.stringify(edits) });
  assert.equal(res.status, 201, await res.clone().text());
  const row = created[created.length - 1];
  assert.ok(Math.abs(row.duration - 3) < 0.2, `duration ${row.duration}`);
  assert.deepEqual(dims(stored(row)), [360, 640]);
});

test('edits that only cut one section behave as a plain trim', { skip: !haveFfmpeg }, async () => {
  const src = gen('src.mp4', '640x360', 8, 25);
  const res = await upload(src, { edits: JSON.stringify({ segments: [{ start: 2, end: 5 }] }) });
  assert.equal(res.status, 201, await res.clone().text());
  assert.ok(Math.abs(created[created.length - 1].duration - 3) < 0.2);
});

test('the 60 s limit is measured after speed: a 100 s source needs 2x or a trim', { skip: !haveFfmpeg }, async () => {
  const src = gen('long.mp4', '160x90', 100, 5);
  const refused = await upload(src);
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).code, 'VIDEO_TOO_LONG');
  const sped = await upload(src, { edits: JSON.stringify({ speed: 2 }) });
  assert.equal(sped.status, 201, await sped.clone().text());
  assert.ok(Math.abs(created[created.length - 1].duration - 50) < 1);
  fs.unlinkSync(src);
});

test('bad edits are refused with INVALID_EDIT and leave no files behind', { skip: !haveFfmpeg }, async () => {
  const src = gen('src.mp4', '320x180', 3, 25);
  const before = created.length;
  const filesBefore = fs.readdirSync(path.join(root, 'videos')).length;
  const res = await upload(src, { edits: JSON.stringify({ speed: 9 }) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'INVALID_EDIT');
  assert.equal(created.length, before);
  assert.equal(fs.readdirSync(path.join(root, 'videos')).length, filesBefore, 'a refused upload must not leave its temp file');
});

test('text overlays render when a font exists, and are refused clearly when none does', { skip: !haveFfmpeg }, async () => {
  const { findOverlayFont } = require('../dist/lib/video/videoTranscode.js');
  const src = gen('src.mp4', '640x360', 4, 25);
  const edits = JSON.stringify({ texts: [{ text: 'Fresh mangoes', start: 0, end: 3 }] });
  if (findOverlayFont()) {
    const ok = await upload(src, { edits });
    assert.equal(ok.status, 201, await ok.clone().text());
  }
  const saved = process.env.TRANSCODE_FONT_FILE;
  process.env.TRANSCODE_FONT_FILE = '/nonexistent/font.ttf';
  try {
    const res = await upload(src, { edits });
    assert.equal(res.status, 422);
    assert.equal((await res.json()).code, 'TEXT_UNAVAILABLE');
  } finally {
    if (saved === undefined) delete process.env.TRANSCODE_FONT_FILE; else process.env.TRANSCODE_FONT_FILE = saved;
  }
});
