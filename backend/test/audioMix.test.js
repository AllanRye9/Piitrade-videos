// Tests for adding an audio track to a video (backend/src/lib/video/audioMix.ts
// and the audio path of lib/video/videoTranscode.ts). The first group is pure
// logic; the last group runs real ffmpeg and is skipped if it isn't installed.
//
// Run with: npm test  (after `npm run build` — this requires dist/).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveAudioMix, buildAudioFilter } = require('../dist/lib/video/audioMix.js');
const { HttpError } = require('../dist/lib/core/httpError.js');

function expectInvalid(fn) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 400);
    assert.equal(err.code, 'INVALID_AUDIO');
    return err;
  }
  assert.fail('expected INVALID_AUDIO');
}

test('defaults: uploaded sound at full volume, starting at the beginning', () => {
  assert.deepEqual(resolveAudioMix({}, 120), { audioVolume: 1, audioStart: 0 });
});

test('form-field strings are parsed', () => {
  assert.deepEqual(resolveAudioMix({ videoVolume: '1', audioVolume: '0.8', audioStart: '12.5' }, 120), {
    audioVolume: 0.8,
    audioStart: 12.5,
  });
});

test('legacy original-volume settings cannot mix source sound back in', () => {
  assert.deepEqual(resolveAudioMix({ videoVolume: 1, audioVolume: 1 }, 60), { audioVolume: 1, audioStart: 0 });
});

test('invalid mixes are rejected', () => {
  expectInvalid(() => resolveAudioMix({ audioVolume: -0.1 }, 60)); // negative
  expectInvalid(() => resolveAudioMix({ audioVolume: 5 }, 60)); // absurd boost
  expectInvalid(() => resolveAudioMix({ audioVolume: 0 }, 60)); // no audio at all after replacement
  expectInvalid(() => resolveAudioMix({ audioStart: -2 }, 60));
  expectInvalid(() => resolveAudioMix({ audioStart: 60 }, 60)); // nothing left to play
  expectInvalid(() => resolveAudioMix({ audioStart: 59.9 }, 60));
});

test('a start just inside the audio is fine', () => {
  assert.equal(resolveAudioMix({ audioStart: 59 }, 60).audioStart, 59);
});

test('filter: uploaded audio replaces source sound at the selected volume', () => {
  assert.equal(buildAudioFilter({ audioVolume: 0.8 }), '[1:a]volume=0.8,apad[aout]');
});

// ---- real ffmpeg -----------------------------------------------------

const haveFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

function ff(args) {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args]);
}
function probe(file, entries) {
  return execFileSync('ffprobe', ['-v', 'error', ...entries, '-of', 'default=nw=1', file]).toString();
}
/** Mean volume in dB, as measured by ffmpeg's volumedetect. */
function meanDb(file) {
  const r = spawnSync('ffmpeg', ['-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume: (-?[\d.]+) dB/.exec(r.stderr);
  return m ? Number(m[1]) : -Infinity;
}

test('real ffmpeg: audio is added, cut to the clip, and honours volume + start', { skip: !haveFfmpeg }, async () => {
  const { transcodeToMp4 } = require('../dist/lib/video/videoTranscode.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiomix-'));
  const silentVideo = path.join(dir, 'silent.mp4');
  const music = path.join(dir, 'music.mp3');
  ff(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silentVideo]);
  ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=40', '-c:a', 'libmp3lame', music]);

  // A silent video gains an audio stream, and it is cut to the clip length
  // even though the music is 40s long.
  const full = path.join(dir, 'full.mp4');
  await transcodeToMp4(silentVideo, full, {
    startSeconds: 0,
    durationSeconds: 10,
    audio: { path: music, startSeconds: 0, audioVolume: 1 },
  });
  assert.match(probe(full, ['-select_streams', 'a', '-show_entries', 'stream=codec_name']), /codec_name=aac/);
  const dur = Number(/duration=([\d.]+)/.exec(probe(full, ['-show_entries', 'format=duration']))[1]);
  assert.ok(dur > 9.8 && dur < 10.3, `output should be ~10s, was ${dur}`);

  // Volume is honoured: 25% is audibly (≈12 dB) quieter than 100%.
  const quiet = path.join(dir, 'quiet.mp4');
  await transcodeToMp4(silentVideo, quiet, {
    startSeconds: 0,
    durationSeconds: 10,
    audio: { path: music, startSeconds: 0, audioVolume: 0.25 },
  });
  const diff = meanDb(full) - meanDb(quiet);
  assert.ok(diff > 10 && diff < 14, `25% volume should be ~12dB quieter, was ${diff.toFixed(1)}dB`);

  // Start offset beyond the end of a short track leaves the rest silent
  // (padded) instead of shortening the video.
  const late = path.join(dir, 'late.mp4');
  await transcodeToMp4(silentVideo, late, {
    startSeconds: 0,
    durationSeconds: 10,
    audio: { path: music, startSeconds: 39, audioVolume: 1 },
  });
  const lateDur = Number(/duration=([\d.]+)/.exec(probe(late, ['-show_entries', 'format=duration']))[1]);
  assert.ok(lateDur > 9.8 && lateDur < 10.3, `padded output should still be ~10s, was ${lateDur}`);

  // A video that already has sound keeps just the uploaded sound.
  const talky = path.join(dir, 'talky.mp4');
  ff(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', talky]);
  const mixed = path.join(dir, 'mixed.mp4');
  await transcodeToMp4(talky, mixed, {
    startSeconds: 0,
    durationSeconds: 10,
    audio: { path: music, startSeconds: 0, audioVolume: 1 },
  });
  const streams = probe(mixed, ['-show_entries', 'stream=codec_type']).match(/codec_type=audio/g) || [];
  assert.equal(streams.length, 1, 'replacement must produce a single audio stream');
  assert.ok(Math.abs(meanDb(mixed) - meanDb(full)) < 1.5, 'only the uploaded sound should be audible');

  fs.rmSync(dir, { recursive: true, force: true });
});
