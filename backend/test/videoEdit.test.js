// Video editing (lib/video/videoEdit.ts): validation, the ffmpeg graph, and real renders.
// Run with: npm test  (after `npm run build` — this requires dist/).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const E = require('../dist/lib/video/videoEdit.js');
const { HttpError } = require('../dist/lib/core/httpError.js');

function code(fn) {
  try { fn(); } catch (err) { assert.ok(err instanceof HttpError); assert.equal(err.status, 400); return err.code; }
  assert.fail('expected an error');
}

test('empty edits keep the whole video untouched', () => {
  const p = E.resolveEdits({}, 20);
  assert.deepEqual(p.edits.segments, [{ start: 0, end: 20 }]);
  assert.equal(p.outputSeconds, 20);
  assert.ok(E.isPlainCut(p.edits));
});

test('edits arrive as JSON text from the form', () => {
  assert.equal(E.resolveEdits('{"speed":2}', 20).outputSeconds, 10);
  assert.equal(code(() => E.resolveEdits('{nope', 20)), 'INVALID_EDIT');
  assert.equal(code(() => E.resolveEdits('[1]', 20)), 'INVALID_EDIT');
});

test('kept sections: order, overlap, bounds and minimum length are enforced', () => {
  const ok = E.resolveEdits({ segments: [{ start: 1, end: 3 }, { start: 5, end: 9 }] }, 20);
  assert.equal(ok.outputSeconds, 6);
  assert.equal(code(() => E.resolveEdits({ segments: [{ start: 5, end: 9 }, { start: 1, end: 3 }] }, 20)), 'INVALID_EDIT');
  assert.equal(code(() => E.resolveEdits({ segments: [{ start: 1, end: 4 }, { start: 3, end: 6 }] }, 20)), 'INVALID_EDIT');
  assert.equal(code(() => E.resolveEdits({ segments: [{ start: 25, end: 30 }] }, 20)), 'INVALID_EDIT');
  assert.equal(code(() => E.resolveEdits({ segments: [{ start: 1, end: 1.1 }] }, 20)), 'INVALID_EDIT');
  assert.equal(code(() => E.resolveEdits({ segments: [] }, 20)), 'INVALID_EDIT');
  assert.equal(E.resolveEdits({ segments: [{ start: 15, end: 99 }] }, 20).edits.segments[0].end, 20); // end clamps to the video
});

test('the 60 s cap is measured on the edited clip: speed-up fits a longer source, slow-down can exceed it', () => {
  assert.equal(E.resolveEdits({ speed: 2 }, 100).outputSeconds, 50);
  assert.equal(code(() => E.resolveEdits({ speed: 2 }, 130)), 'VIDEO_TOO_LONG');
  assert.equal(code(() => E.resolveEdits({ segments: [{ start: 0, end: 40 }], speed: 0.5 }, 100)), 'VIDEO_TOO_LONG');
  assert.equal(code(() => E.resolveEdits({ segments: [{ start: 0, end: 1 }], speed: 4 }, 100)), 'INVALID_EDIT'); // 0.25 s result
});

test('ranges: speed, rotation, crop, look, fades, volume', () => {
  assert.equal(code(() => E.resolveEdits({ speed: 8 }, 20)), 'INVALID_EDIT');
  assert.equal(code(() => E.resolveEdits({ rotate: 45 }, 20)), 'INVALID_EDIT');
  assert.equal(E.resolveEdits({ rotate: 360 }, 20).edits.rotate, 0);
  assert.equal(code(() => E.resolveEdits({ crop: { x: 0.5, y: 0, w: 0.9, h: 1 } }, 20)), 'INVALID_EDIT');
  assert.equal(code(() => E.resolveEdits({ crop: { x: 0, y: 0, w: 0.05, h: 1 } }, 20)), 'INVALID_EDIT');
  assert.equal(E.resolveEdits({ crop: { x: 0, y: 0, w: 1, h: 1 } }, 20).edits.crop, null);
  assert.equal(code(() => E.resolveEdits({ look: { preset: 'rainbow' } }, 20)), 'INVALID_EDIT');
  assert.equal(code(() => E.resolveEdits({ look: { contrast: 3 } }, 20)), 'INVALID_EDIT');
  assert.equal(code(() => E.resolveEdits({ volume: 5 }, 20)), 'INVALID_EDIT');
  // fades can never overlap each other on a short clip
  const f = E.resolveEdits({ segments: [{ start: 0, end: 2 }], fadeIn: 3, fadeOut: 3 }, 20).edits;
  assert.ok(f.fadeIn + f.fadeOut <= 2.0001);
});

test('text overlays: sanitised, bounded, and timed on the edited clip', () => {
  const t = E.resolveEdits({ texts: [{ text: '  Fresh   tomatoes 😀\u0007 ', start: 0, end: 99 }] }, 10).edits.texts[0];
  assert.equal(t.text, 'Fresh tomatoes');
  assert.equal(t.end, 10);
  assert.equal(t.color, '#FFFFFF');
  assert.equal(code(() => E.resolveEdits({ texts: [{ text: '😀' }] }, 10)), 'INVALID_EDIT');
  assert.equal(code(() => E.resolveEdits({ texts: [{ text: 'x', start: 11 }] }, 10)), 'INVALID_EDIT');
  assert.equal(code(() => E.resolveEdits({ texts: [{ text: 'x', color: 'red' }] }, 10)), 'INVALID_EDIT');
  assert.equal(code(() => E.resolveEdits({ texts: [{ text: 'a'.repeat(81) }] }, 10)), 'INVALID_EDIT');
  assert.equal(code(() => E.resolveEdits({ texts: Array(6).fill({ text: 'x' }) }, 10)), 'INVALID_EDIT');
});

test('overlay layout always fits the frame and never exceeds 3 lines', () => {
  for (const [w, h] of [[1080, 1920], [1920, 1080], [320, 240]]) {
    const L = E.layoutOverlay('Brand new phone — UGX 800,000 negotiable, call today', w, h, 0.05);
    const lines = L.text.split('\n');
    assert.ok(lines.length <= 3);
    const widest = Math.max(...lines.map((l) => l.length)) * L.fontSize * 0.68;
    assert.ok(widest <= w, `${widest} > ${w}`);
  }
});

test('plain cut detection', () => {
  assert.equal(E.isPlainCut(E.resolveEdits({ segments: [{ start: 2, end: 9 }] }, 20).edits), true);
  assert.equal(E.isPlainCut(E.resolveEdits({ speed: 1.5 }, 20).edits), false);
  assert.equal(E.isPlainCut(E.resolveEdits({ segments: [{ start: 0, end: 2 }, { start: 3, end: 5 }] }, 20).edits), false);
});

test('tempo chain stays inside the 0.5–2 range per filter', () => {
  assert.deepEqual(E.tempoChain(1), []);
  assert.deepEqual(E.tempoChain(1.5), ['atempo=1.5']);
  assert.deepEqual(E.tempoChain(4), ['atempo=2', 'atempo=2']);
  assert.deepEqual(E.tempoChain(0.25), ['atempo=0.5', 'atempo=0.5']);
});

const probe = { width: 1920, height: 1080, fps: 30, hasAudio: true, duration: 20 };
const ctx = (over = {}) => ({ probe, sourceHasAudio: true, addedAudioVolume: null, fontFile: '/f.ttf', writeText: (i) => `/tmp/t${i}.txt`, ...over });

test('graph: sections are seeked relative to the first one and joined', () => {
  const plan = E.resolveEdits({ segments: [{ start: 2, end: 4 }, { start: 6, end: 9 }] }, 20);
  assert.deepEqual(E.inputWindow(plan), { start: 2, duration: 7 });
  const g = E.buildEditGraph(plan, ctx());
  const text = g.filterComplex.join(';');
  assert.match(text, /\[0:v\]trim=start=0:end=2,setpts=PTS-STARTPTS\[v0\]/);
  assert.match(text, /\[0:v\]trim=start=4:end=7/);
  assert.match(text, /concat=n=2:v=1:a=1\[vcat\]\[acat\]/);
  assert.equal(g.audioLabel, 'aout');
});

test('graph: a source without sound has no audio chain; added audio replaces the source sound', () => {
  const plan = E.resolveEdits({ speed: 2, fadeOut: 1 }, 20);
  assert.equal(E.buildEditGraph(plan, ctx({ sourceHasAudio: false })).audioLabel, null);
  const added = E.buildEditGraph(plan, ctx({ addedAudioVolume: 0.8 }));
  const t = added.filterComplex.join(';');
  assert.match(t, /\[1:a\]volume=0\.8,apad,afade=t=out:st=9:d=1\[aout\]/);
  assert.doesNotMatch(t, /atempo/); // the uploader's music is not sped up with the picture
});

test('graph: size standard is applied after crop; odd results become even', () => {
  const plan = E.resolveEdits({ crop: { x: 0, y: 0, w: 0.5, h: 1 } }, 20);
  const g = E.buildEditGraph(plan, ctx({ probe: { ...probe, width: 3840, height: 2160 } }));
  assert.deepEqual([g.width, g.height], [1080, 1214]); // 1920x2160 after the crop, fitted to the 1080x1920 box
  assert.equal(g.width % 2, 0);
  assert.equal(g.height % 2, 0);
  assert.ok(g.width <= 1080 && g.height <= 1920);
});

test('graph: text without a font is refused with a clear code', () => {
  const plan = E.resolveEdits({ texts: [{ text: 'hi' }] }, 20);
  try { E.buildEditGraph(plan, ctx({ fontFile: null })); } catch (e) { assert.equal(e.code, 'TEXT_UNAVAILABLE'); return; }
  assert.fail('expected TEXT_UNAVAILABLE');
});

// ---- real ffmpeg -------------------------------------------------------------

const haveFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const { transcodeToMp4, findOverlayFont } = require('../dist/lib/video/videoTranscode.js');
const { probeVideo } = require('../dist/lib/video/videoStandard.js');

function gen(dir, name, { size = '640x360', rate = 25, secs = 6, audio = true }) {
  const out = path.join(dir, name);
  const args = ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${rate}:duration=${secs}`];
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}`);
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p');
  if (audio) args.push('-c:a', 'aac', '-shortest');
  execFileSync('ffmpeg', [...args, out]);
  return out;
}
const info = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString());

test('real ffmpeg: cut two sections, speed up, rotate, crop, look, fades and text — length, size and sound are right', { skip: !haveFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-'));
  try {
    const src = gen(dir, 'src.mp4', {});
    const pr = await probeVideo(src);
    const plan = E.resolveEdits({
      segments: [{ start: 0.5, end: 2 }, { start: 3, end: 5 }], speed: 1.5, rotate: 90, crop: { x: 0, y: 0, w: 1, h: 0.5 },
      look: { preset: 'warm' }, fadeIn: 0.3, fadeOut: 0.3, volume: 0.5,
      texts: findOverlayFont() ? [{ text: 'Fresh tomatoes UGX 5,000', start: 0, end: 2 }] : [],
    }, pr.duration);
    const out = path.join(dir, 'out.mp4');
    await transcodeToMp4(src, out, { probe: pr, edit: plan, fontFile: findOverlayFont() });
    const i = info(out);
    const v = i.streams.find((s) => s.codec_type === 'video');
    assert.ok(Math.abs(Number(i.format.duration) - plan.outputSeconds) < 0.15, `duration ${i.format.duration} vs ${plan.outputSeconds}`);
    assert.equal(plan.outputSeconds, 2.333);
    // 640x360 rotated 90° = 360x640, cropped to the top half = 360x320
    assert.deepEqual([v.width, v.height], [360, 320]);
    assert.ok(i.streams.some((s) => s.codec_type === 'audio'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('real ffmpeg: a silent source edits fine and stays silent; muting keeps the track', { skip: !haveFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-'));
  try {
    const silent = gen(dir, 'silent.mp4', { audio: false, secs: 4 });
    const ps = await probeVideo(silent);
    const out = path.join(dir, 'a.mp4');
    await transcodeToMp4(silent, out, { probe: ps, edit: E.resolveEdits({ speed: 2, flipH: true }, ps.duration) });
    assert.equal(info(out).streams.some((s) => s.codec_type === 'audio'), false);
    const loud = gen(dir, 'loud.mp4', { secs: 4 });
    const pl = await probeVideo(loud);
    const out2 = path.join(dir, 'b.mp4');
    await transcodeToMp4(loud, out2, { probe: pl, edit: E.resolveEdits({ volume: 0 }, pl.duration) });
    const r = spawnSync('ffmpeg', ['-i', out2, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
    assert.match(r.stderr, /mean_volume: -91|max_volume: -91|mean_volume: -inf/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('real ffmpeg: edits plus an added audio track', { skip: !haveFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-'));
  try {
    const src = gen(dir, 'src.mp4', { secs: 5 });
    const music = path.join(dir, 'm.mp3');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=10', music]);
    const pr = await probeVideo(src);
    const plan = E.resolveEdits({ segments: [{ start: 1, end: 4 }], rotate: 180, fadeOut: 0.5 }, pr.duration);
    const out = path.join(dir, 'o.mp4');
    await transcodeToMp4(src, out, { probe: pr, edit: plan, audio: { path: music, startSeconds: 2, audioVolume: 0.8 } });
    const i = info(out);
    assert.ok(Math.abs(Number(i.format.duration) - 3) < 0.15);
    assert.ok(i.streams.some((s) => s.codec_type === 'audio'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a crop shape is placed by the server from the real frame size', () => {
  const p = E.resolveEdits({ frame: { aspect: '9:16', zoom: 1, panX: 0, panY: 0 } }, 20);
  assert.equal(p.edits.frame.aspect, '9:16');
  assert.equal(E.isPlainCut(p.edits), false);
  // 16:9 frame → 9:16 strip, centred
  const r = E.cropRectFromFrame(p.edits.frame, 1920, 1080);
  assert.ok(Math.abs(r.h - 1) < 1e-9 && Math.abs(r.w - (9 / 16) / (16 / 9)) < 1e-9 && Math.abs(r.x + r.w / 2 - 0.5) < 1e-9);
  assert.equal(E.cropRectFromFrame({ aspect: '16:9', zoom: 1, panX: 0, panY: 0 }, 1920, 1080), null);
  const g = E.buildEditGraph(p, { probe: { width: 1920, height: 1080, fps: 30, hasAudio: true, duration: 20 }, sourceHasAudio: true, addedAudioVolume: null, fontFile: null, writeText: () => '' });
  assert.match(g.filterComplex.join(';'), /crop=606:1080:656:0/);
  assert.equal(code(() => E.resolveEdits({ frame: { aspect: '3:2' } }, 20)), 'INVALID_EDIT');
  assert.equal(code(() => E.resolveEdits({ frame: { aspect: '1:1' }, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } }, 20)), 'INVALID_EDIT');
});
