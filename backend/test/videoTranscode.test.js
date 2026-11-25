// Runs the real ffmpeg (skipped when it isn't installed): the encode succeeds, big sources are scaled
// down but small ones never enlarged, and a damaged file fails with a precise, classified cause.
// Run with: npm test (after `npm run build`).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { transcodeToMp4, scaleFilter } = require('../dist/lib/videoTranscode.js');
const { describeTranscodeFailure } = require('../dist/lib/mediaErrors.js');

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'transcode-'));

function make(name, size, seconds = 1) {
  const out = path.join(tmp, name);
  const r = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=10:duration=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-shortest', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', out]);
  assert.equal(r.status, 0, String(r.stderr));
  return out;
}
function dims(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [w, h] = String(r.stdout).trim().split(',').map(Number);
  return { w, h };
}

test('scaleFilter caps the longer side and never enlarges', { skip: !hasFfmpeg }, () => {
  assert.match(scaleFilter(1920), /min\(1920,iw\)/);
});

test('a 4K landscape source is scaled to 1920 wide, keeping its shape', { skip: !hasFfmpeg }, async () => {
  const src = make('4k.mp4', '3840x2160');
  const out = path.join(tmp, '4k-out.mp4');
  await transcodeToMp4(src, out);
  assert.deepEqual(dims(out), { w: 1920, h: 1080 });
});

test('a portrait 4K source is capped on its height', { skip: !hasFfmpeg }, async () => {
  const src = make('4k-portrait.mp4', '2160x3840');
  const out = path.join(tmp, '4k-portrait-out.mp4');
  await transcodeToMp4(src, out);
  assert.deepEqual(dims(out), { w: 1080, h: 1920 });
});

test('a small source is not enlarged', { skip: !hasFfmpeg }, async () => {
  const src = make('small.mp4', '320x180');
  const out = path.join(tmp, 'small-out.mp4');
  await transcodeToMp4(src, out);
  assert.deepEqual(dims(out), { w: 320, h: 180 });
});

test('trimming and an added audio track still work together with the scaling', { skip: !hasFfmpeg }, async () => {
  const src = make('trim.mp4', '1280x720', 3);
  const music = path.join(tmp, 'music.m4a');
  const r = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', '-c:a', 'aac', music]);
  assert.equal(r.status, 0);
  const out = path.join(tmp, 'trim-out.mp4');
  await transcodeToMp4(src, out, { startSeconds: 1, durationSeconds: 1, audio: { path: music, startSeconds: 0, audioVolume: 0.7, videoVolume: 1, hasSourceAudio: true } });
  assert.deepEqual(dims(out), { w: 1280, h: 720 });
  const d = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]);
  assert.ok(Math.abs(Number(String(d.stdout).trim()) - 1) < 0.3);
});

test('a damaged file fails with a classified, user-readable cause', { skip: !hasFfmpeg }, async () => {
  const bad = path.join(tmp, 'bad.mp4');
  fs.writeFileSync(bad, Buffer.from('this is definitely not a video file '.repeat(200)));
  const out = path.join(tmp, 'bad-out.mp4');
  await assert.rejects(transcodeToMp4(bad, out), (err) => {
    const f = describeTranscodeFailure(err);
    assert.notEqual(f.code, 'PROCESSING_FAILED', `expected a specific cause, got: ${err.stderr}`);
    assert.ok(['VIDEO_CORRUPT', 'NO_VIDEO_STREAM', 'UNSUPPORTED_CODEC'].includes(f.code), f.code);
    assert.ok(f.message.length > 20);
    return true;
  });
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
