// The Piitrade frame standard (lib/video/videoStandard.ts): pure rules plus real-ffmpeg checks.
// Run with: npm test  (after `npm run build` — this requires dist/).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../dist/lib/video/videoStandard.js');

test('4K landscape is shrunk to 1920x1080, 4K portrait to 1080x1920', () => {
  assert.deepEqual(S.fitFrame(3840, 2160), { width: 1920, height: 1080, scaled: true });
  assert.deepEqual(S.fitFrame(2160, 3840), { width: 1080, height: 1920, scaled: true });
});

test('frames inside the standard are never upscaled', () => {
  assert.deepEqual(S.fitFrame(1280, 720), { width: 1280, height: 720, scaled: false });
  assert.deepEqual(S.fitFrame(720, 1280), { width: 720, height: 1280, scaled: false });
  assert.deepEqual(S.fitFrame(320, 240), { width: 320, height: 240, scaled: false });
});

test('sides are always even and the aspect ratio is kept', () => {
  assert.deepEqual(S.fitFrame(1079, 1919), { width: 1078, height: 1918, scaled: true });
  const f = S.fitFrame(4001, 3001);
  assert.equal(f.width % 2, 0);
  assert.equal(f.height % 2, 0);
  assert.ok(Math.abs(f.width / f.height - 4001 / 3001) < 0.01);
  const sq = S.fitFrame(3000, 3000);
  assert.deepEqual([sq.width, sq.height], [1080, 1080]);
});

test('bad dimensions are rejected', () => {
  assert.throws(() => S.fitFrame(0, 100), RangeError);
});

test('frame rate is capped at 30 only when the source is faster', () => {
  assert.equal(S.fpsCap(60), 30);
  assert.equal(S.fpsCap(30), null);
  assert.equal(S.fpsCap(29.97), null);
  assert.equal(S.fpsCap(null), null);
});

test('bitrate ceiling scales with the frame and stays within bounds', () => {
  assert.equal(S.videoBitrateCeilingKbps(1920, 1080), 5000);
  assert.equal(S.videoBitrateCeilingKbps(3840, 2160), 5000);
  assert.equal(S.videoBitrateCeilingKbps(320, 240), 1200);
  const mid = S.videoBitrateCeilingKbps(1280, 720);
  assert.ok(mid > 1200 && mid < 5000);
});

test('probe summary applies phone rotation metadata to the frame size', () => {
  const meta = { format: { duration: '10.5' }, streams: [{ codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30000/1001', side_data_list: [{ rotation: -90 }] }, { codec_type: 'audio' }] };
  const p = S.summarizeProbe(meta);
  assert.equal(p.width, 1080);
  assert.equal(p.height, 1920);
  assert.equal(p.hasAudio, true);
  assert.ok(Math.abs(p.fps - 29.97) < 0.01);
  assert.equal(p.duration, 10.5);
  assert.equal(S.summarizeProbe({ streams: [{ codec_type: 'audio' }] }), null);
});

const haveFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
test('real ffmpeg: a 4K/60fps upload is stored at 1080p/30fps, an odd-sized one at even size', { skip: !haveFfmpeg }, async () => {
  const { transcodeToMp4 } = require('../dist/lib/video/videoTranscode.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'std-'));
  try {
    const big = path.join(dir, 'big.mp4');
    const odd = path.join(dir, 'odd.mp4');
    const gen = (out, size, rate) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${rate}:duration=2`, '-f', 'lavfi', '-i', 'sine=duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out]);
    gen(big, '3840x2160', 60);
    gen(odd, '1078x1918', 25);
    const dims = (f) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', f]).toString().trim();
    await transcodeToMp4(big, path.join(dir, 'a.mp4'), { probe: await S.probeVideo(big) });
    assert.equal(dims(path.join(dir, 'a.mp4')), '1920,1080,30/1');
    await transcodeToMp4(odd, path.join(dir, 'b.mp4'), { probe: await S.probeVideo(odd) });
    assert.equal(dims(path.join(dir, 'b.mp4')), '1078,1918,25/1');
    // sound survives
    assert.match(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path.join(dir, 'a.mp4')]).toString(), /audio/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
