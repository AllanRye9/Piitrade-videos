// Tests for adding an audio track to a video (backend/src/lib/audioMix.ts
// and the audio path of lib/videoTranscode.ts). The first group is pure
// logic; the last group runs real ffmpeg and is skipped if it isn't installed.
//
// Run with: npm test  (after `npm run build` — this requires dist/).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveAudioMix, buildAudioFilter } = require('../dist/lib/audioMix.js');
const { HttpError } = require('../dist/lib/httpError.js');

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

test('defaults: both sounds at full volume, starting at the beginning', () => {
  assert.deepEqual(resolveAudioMix({}, 120), { videoVolume: 1, audioVolume: 1, audioStart: 0 });
});

test('form-field strings are parsed', () => {
  assert.deepEqual(resolveAudioMix({ videoVolume: '0.4', audioVolume: '0.8', audioStart: '12.5' }, 120), {
    videoVolume: 0.4,
    audioVolume: 0.8,
    audioStart: 12.5,
  });
});

test('original sound at 0 (replace) is allowed', () => {
  assert.equal(resolveAudioMix({ videoVolume: 0, audioVolume: 1 }, 60).videoVolume, 0);
});

test('invalid mixes are rejected', () => {
  expectInvalid(() => resolveAudioMix({ videoVolume: 'loud' }, 60)); // not a number
  expectInvalid(() => resolveAudioMix({ audioVolume: -0.1 }, 60)); // negative
  expectInvalid(() => resolveAudioMix({ audioVolume: 5 }, 60)); // absurd boost
  expectInvalid(() => resolveAudioMix({ videoVolume: 0, audioVolume: 0 }, 60)); // silence on silence
  expectInvalid(() => resolveAudioMix({ audioStart: -2 }, 60));
  expectInvalid(() => resolveAudioMix({ audioStart: 60 }, 60)); // nothing left to play
  expectInvalid(() => resolveAudioMix({ audioStart: 59.9 }, 60));
});

test('a start just inside the audio is fine', () => {
  assert.equal(resolveAudioMix({ audioStart: 59 }, 60).audioStart, 59);
});

test('filter: video with sound + added audio are mixed at the chosen volumes', () => {
  const f = buildAudioFilter({ hasSourceAudio: true, videoVolume: 0.5, audioVolume: 0.8 });
  assert.match(f, /\[0:a\]volume=0\.5\[a0\]/);
  assert.match(f, /\[1:a\]volume=0\.8,apad\[a1\]/);
  assert.match(f, /amix=inputs=2:duration=first:normalize=0\[aout\]/);
});

test('filter: replacing the original sound uses the added audio alone', () => {
  const f = buildAudioFilter({ hasSourceAudio: true, videoVolume: 0, audioVolume: 1 });
  assert.equal(f, '[1:a]volume=1,apad[aout]');
});

test('filter: a silent source video gets the added audio alone', () => {
  const f = buildAudioFilter({ hasSourceAudio: false, videoVolume: 1, audioVolume: 0.7 });
  assert.equal(f, '[1:a]volume=0.7,apad[aout]');
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
  const { transcodeToMp4 } = require('../dist/lib/videoTranscode.js');
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
    audio: { path: music, startSeconds: 0, audioVolume: 1, videoVolume: 1, hasSourceAudio: false },
  });
  assert.match(probe(full, ['-select_streams', 'a', '-show_entries', 'stream=codec_name']), /codec_name=aac/);
  const dur = Number(/duration=([\d.]+)/.exec(probe(full, ['-show_entries', 'format=duration']))[1]);
  assert.ok(dur > 9.8 && dur < 10.3, `output should be ~10s, was ${dur}`);

  // Volume is honoured: 25% is audibly (≈12 dB) quieter than 100%.
  const quiet = path.join(dir, 'quiet.mp4');
  await transcodeToMp4(silentVideo, quiet, {
    startSeconds: 0,
    durationSeconds: 10,
    audio: { path: music, startSeconds: 0, audioVolume: 0.25, videoVolume: 1, hasSourceAudio: false },
  });
  const diff = meanDb(full) - meanDb(quiet);
  assert.ok(diff > 10 && diff < 14, `25% volume should be ~12dB quieter, was ${diff.toFixed(1)}dB`);

  // Start offset beyond the end of a short track leaves the rest silent
  // (padded) instead of shortening the video.
  const late = path.join(dir, 'late.mp4');
  await transcodeToMp4(silentVideo, late, {
    startSeconds: 0,
    durationSeconds: 10,
    audio: { path: music, startSeconds: 39, audioVolume: 1, videoVolume: 1, hasSourceAudio: false },
  });
  const lateDur = Number(/duration=([\d.]+)/.exec(probe(late, ['-show_entries', 'format=duration']))[1]);
  assert.ok(lateDur > 9.8 && lateDur < 10.3, `padded output should still be ~10s, was ${lateDur}`);

  // A video that already has sound: mixing keeps ONE audio stream; replacing
  // (original at 0) ends up with only the added audio's loudness.
  const talky = path.join(dir, 'talky.mp4');
  ff(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', talky]);
  const mixed = path.join(dir, 'mixed.mp4');
  await transcodeToMp4(talky, mixed, {
    startSeconds: 0,
    durationSeconds: 10,
    audio: { path: music, startSeconds: 0, audioVolume: 1, videoVolume: 1, hasSourceAudio: true },
  });
  const streams = probe(mixed, ['-show_entries', 'stream=codec_type']).match(/codec_type=audio/g) || [];
  assert.equal(streams.length, 1, 'mixing must produce a single audio stream');
  assert.ok(meanDb(mixed) > meanDb(full) + 1.5, 'two sounds mixed at full volume should be louder than one');

  const replaced = path.join(dir, 'replaced.mp4');
  await transcodeToMp4(talky, replaced, {
    startSeconds: 0,
    durationSeconds: 10,
    audio: { path: music, startSeconds: 0, audioVolume: 1, videoVolume: 0, hasSourceAudio: true },
  });
  assert.ok(Math.abs(meanDb(replaced) - meanDb(full)) < 1.5, 'original at 0% should leave only the added audio');

  fs.rmSync(dir, { recursive: true, force: true });
});
