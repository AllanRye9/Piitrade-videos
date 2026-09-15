// Regression tests for GET /api/videos/:id/download. Deliberately does
// NOT mock ffmpeg — the whole point of this route is the actual
// watermark burn-in (see lib/watermark.ts), so these tests run the
// real ffmpeg binary against a real generated test video and check
// the real output (status codes, caching behavior, actual streams).
//
// Requires ffmpeg to be installed (it is, in the Docker image and in
// most dev machines with this repo's other video features already
// working) and needs its own scratch upload directory, set via
// UPLOAD_DIR below before paths.ts is first imported.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piitrade-download-test-'));
process.env.UPLOAD_DIR = scratchDir;
// index.ts normally creates every uploads subdirectory (including
// downloads/) at server startup — this test loads routes/videos.js
// directly, bypassing that, so it's done here instead.
fs.mkdirSync(path.join(scratchDir, 'videos'), { recursive: true });
fs.mkdirSync(path.join(scratchDir, 'downloads'), { recursive: true });

// A tiny real video (not a mock) — this route re-encodes, so it needs
// an actual decodable video file to run ffmpeg against.
const sourceVideoPath = path.join(scratchDir, 'videos', 'testvideo123.mp4');
execFileSync('ffmpeg', [
  '-y',
  '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x180:rate=25',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
  '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p',
  sourceVideoPath,
]);

const dbPath = path.resolve(__dirname, '../dist/db.js');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    prisma: {
      video: {
        findUnique: async ({ where }) =>
          where.id === 'testvideo123'
            ? { id: 'testvideo123', title: 'My Cool Video!', filename: 'testvideo123.mp4', posterFilename: null }
            : null,
        update: async ({ where }) => ({ id: where.id }),
      },
    },
  },
};

let server;
let base;

before(async () => {
  require('express-async-errors');
  const express = require('express');
  const videosRouter = require('../dist/routes/videos.js').default;
  const { HttpError } = require('../dist/lib/httpError.js');

  const app = express();
  app.use('/api/videos', videosRouter);
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
  fs.rmSync(scratchDir, { recursive: true, force: true });
});

test('downloading a nonexistent video returns HTTP 404', async () => {
  const res = await fetch(`${base}/api/videos/does-not-exist/download`);
  assert.equal(res.status, 404);
});

test('first download watermarks the video and returns it with the right filename', async () => {
  const res = await fetch(`${base}/api/videos/testvideo123/download`);
  assert.equal(res.status, 200);
  // The title has a space and a `!` — both must be stripped/sanitized
  // for a safe Content-Disposition filename.
  const disposition = res.headers.get('content-disposition') || '';
  assert.match(disposition, /attachment/);
  assert.match(disposition, /filename="My_Cool_Video_?\.mp4"/);

  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 0, 'downloaded file must not be empty');

  // Confirm the cached watermarked file was actually written to disk.
  const cachedPath = path.join(scratchDir, 'downloads', 'testvideo123.mp4');
  assert.ok(fs.existsSync(cachedPath), 'watermarked output should be cached for next time');
});

test('the watermarked download still has both a video and an audio stream', async () => {
  const cachedPath = path.join(scratchDir, 'downloads', 'testvideo123.mp4');
  const probeOutput = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=codec_type',
    '-of', 'csv=p=0',
    cachedPath,
  ]).toString();
  assert.match(probeOutput, /video/, 'watermarking must not drop the video stream');
  assert.match(probeOutput, /audio/, 'watermarking must never strip the audio track');
});

test('a second download of the same video is served from cache, much faster than the first', async () => {
  const start = Date.now();
  const res = await fetch(`${base}/api/videos/testvideo123/download`);
  const elapsed = Date.now() - start;
  assert.equal(res.status, 200);
  // The first request re-encodes (hundreds of ms); a cache hit should
  // be an order of magnitude faster — generous threshold to avoid
  // flakiness on a slow CI machine while still catching "not cached at all".
  assert.ok(elapsed < 200, `cached download took ${elapsed}ms — expected well under 200ms`);
});

// Regression test for a real bug: the centered "intro" watermark used a
// fixed fontsize (48px) that was sized fine against the 1280x720/
// 720x1280 seed videos, but on a small/narrow real upload — 320x180,
// the exact size this test suite's own source video already uses above
// — the watermark's box ran off BOTH the left and right edges of the
// frame, cutting the "piitrade.com" text off entirely instead of
// showing it. Fixed by sizing the watermark as a clamped expression of
// the video's own min(w,h) instead of a fixed pixel count (see
// lib/watermark.ts). This reads actual output pixels (not just "did
// ffmpeg exit 0") to catch a silent-but-broken render, not just a crash.
test('the centered watermark stays fully inside the frame on a small (320x180) video, not cut off at the edges', async () => {
  const smallSourcePath = path.join(scratchDir, 'videos', 'smallsolid1.mp4');
  execFileSync('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    smallSourcePath,
  ]);

  const dbModule = require.cache[dbPath].exports;
  const originalFindUnique = dbModule.prisma.video.findUnique;
  dbModule.prisma.video.findUnique = async ({ where }) =>
    where.id === 'smallsolid1'
      ? { id: 'smallsolid1', title: 'Small Solid', filename: 'smallsolid1.mp4', posterFilename: null }
      : originalFindUnique({ where });

  const res = await fetch(`${base}/api/videos/smallsolid1/download`);
  assert.equal(res.status, 200);
  const cachedPath = path.join(scratchDir, 'downloads', 'smallsolid1.mp4');

  // Grab one frame from inside the intro watermark's active window
  // (0–2.6s) as raw RGB pixels so exact pixel colors can be checked —
  // a visual assertion, not just "did the command succeed".
  const width = 320;
  const height = 180;
  const raw = execFileSync('ffmpeg', [
    '-y', '-ss', '1.0', '-i', cachedPath,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
    'pipe:1',
  ], { maxBuffer: 10 * 1024 * 1024 });

  function pixelAt(x, y) {
    const offset = (y * width + x) * 3;
    return [raw[offset], raw[offset + 1], raw[offset + 2]];
  }

  const midY = Math.floor(height / 2); // the box is vertically centered here
  const leftEdge = pixelAt(0, midY);
  const rightEdge = pixelAt(width - 1, midY);
  const center = pixelAt(Math.floor(width / 2), midY);

  // Pure background blue is (0, 0, 255) — the bug made the watermark's
  // dark box reach all the way to both edges, replacing this color.
  const isBackgroundBlue = ([r, g, b]) => r < 40 && g < 40 && b > 200;
  assert.ok(isBackgroundBlue(leftEdge), `left edge should still be plain background, got rgb(${leftEdge})`);
  assert.ok(isBackgroundBlue(rightEdge), `right edge should still be plain background, got rgb(${rightEdge})`);
  // And the watermark must still actually be visible in the center —
  // fixing the overflow must not have made it disappear entirely.
  assert.ok(!isBackgroundBlue(center), `center should show the watermark box, got rgb(${center})`);
});
