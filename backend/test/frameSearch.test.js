// Find on Piitrade from a screenshot: the frame-by-frame interpretation loop (lib/search/frameSearch.ts).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const F = require('../dist/lib/search/frameSearch.js');

const jpeg = (n) => Buffer.from(`frame-${n}`);
function deps(over = {}) {
  const calls = { grab: [], identify: [], search: [] };
  return {
    calls,
    d: {
      grabFrame: async (t) => { calls.grab.push(t); return jpeg(t); },
      cropFrame: async (b, r) => Buffer.from(`crop:${b}:${r.x}`),
      identify: async (b) => { calls.identify.push(String(b)); return 'red tomatoes'; },
      search: async (q) => { calls.search.push(q); return { n: 2 }; },
      countResults: (o) => o.n,
      ...over,
    },
  };
}

test('frame times start at the viewer position, stay inside the video and are not near-duplicates', () => {
  assert.deepEqual(F.frameTimes(10000, 30000), [10000, 8500, 11500]);
  assert.deepEqual(F.frameTimes(0, 30000), [0, 1500, 3000]); // negatives clamp to 0 and collapse into one
  assert.deepEqual(F.frameTimes(29900, 30000), [29800, 28400, 26900]); // never past the end
  assert.deepEqual(F.frameTimes(500, 900), [500]); // tiny clip: neighbours are too close to differ
});

test('the first frame that is understood and found ends the loop', async () => {
  const { d, calls } = deps();
  const r = await F.interpretFrames(d, { atMs: 5000, durationMs: 20000 });
  assert.equal(calls.grab.length, 1);
  assert.equal(r.best.found, true);
  assert.equal(r.best.identification, 'red tomatoes');
  assert.equal(r.attempts.length, 1);
});

test('when the AI fails on one frame the next moment is tried', async () => {
  let n = 0;
  const { d, calls } = deps({ identify: async () => { if (n++ === 0) throw new Error('timeout'); return 'blue shirt'; } });
  const r = await F.interpretFrames(d, { atMs: 5000, durationMs: 20000 });
  assert.deepEqual(calls.grab, [5000, 3500]);
  assert.equal(r.attempts[0].stopped, 'identify-failed');
  assert.equal(r.best.identification, 'blue shirt');
  assert.equal(r.best.atMs, 3500);
});

test('an unlisted description keeps trying other frames, then reports the first description', async () => {
  const names = ['gizmo', 'widget', 'gadget'];
  let i = 0;
  const { d, calls } = deps({ identify: async () => names[i++], search: async () => ({ n: 0 }) });
  const r = await F.interpretFrames(d, { atMs: 5000, durationMs: 20000 });
  assert.equal(calls.grab.length, F.MAX_FRAME_ATTEMPTS);
  assert.equal(r.best.found, false);
  assert.equal(r.best.identification, 'gizmo');
});

test('a later frame that finds listings beats an earlier one that found none', async () => {
  let i = 0;
  const { d } = deps({ identify: async () => ['gizmo', 'sofa'][i++], search: async (q) => ({ n: q === 'sofa' ? 3 : 0 }) });
  const r = await F.interpretFrames(d, { atMs: 5000, durationMs: 20000 });
  assert.equal(r.best.found, true);
  assert.equal(r.best.identification, 'sofa');
});

test('no frame at all and no description gives no result', async () => {
  const { d } = deps({ grabFrame: async () => null });
  const r = await F.interpretFrames(d, { atMs: 1000, durationMs: 20000 });
  assert.equal(r.best, null);
  assert.ok(r.attempts.every((a) => a.stopped === 'no-frame'));
});

test('a marked region is what the AI sees', async () => {
  const { d, calls } = deps();
  await F.interpretFrames(d, { atMs: 1000, durationMs: 20000, region: { x: 0.25, y: 0, w: 0.5, h: 0.5 } });
  assert.match(calls.identify[0], /^crop:frame-1000:0\.25$/);
});

test('the time budget stops new attempts', async () => {
  let clock = 0;
  const { d, calls } = deps({ now: () => clock, identify: async () => { clock += 20000; return 'x'; }, search: async () => ({ n: 0 }) });
  await F.interpretFrames(d, { atMs: 5000, durationMs: 20000, budgetMs: 15000 });
  assert.equal(calls.grab.length, 1);
});

test('a search failure is not swallowed (it is not about the frame)', async () => {
  const { d } = deps({ search: async () => { throw new Error('shops down'); } });
  await assert.rejects(F.interpretFrames(d, { atMs: 1000, durationMs: 20000 }), /shops down/);
});

const haveFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
test('real ffmpeg: a frame is cut out of a stored video at the requested moment', { skip: !haveFfmpeg }, async () => {
  const { grabFrameJpeg } = require('../dist/lib/video/keyframes.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grab-'));
  try {
    const src = path.join(dir, 'v.mp4');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=25:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', src]);
    const a = await grabFrameJpeg(src, 1000);
    const b = await grabFrameJpeg(src, 3000);
    assert.ok(a && a.length > 1000 && a[0] === 0xff && a[1] === 0xd8, 'a JPEG');
    assert.notDeepEqual(a, b);
    const small = path.join(dir, 's.mp4');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', small]);
    const s = await grabFrameJpeg(small, 500);
    assert.ok(s, 'a small video still gives a frame (never upscaled)');
    assert.equal(await grabFrameJpeg(path.join(dir, 'missing.mp4'), 0), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
