// Tests for backend/src/lib/mediaErrors.ts — turning ffmpeg failures into a precise, user-readable cause.
// Pure logic (no ffmpeg/DB). Run with: npm test (after `npm run build`).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TranscodeError, describeTranscodeFailure, lastReason, referenceId } = require('../dist/lib/mediaErrors.js');

const classify = (stderr, opts, msg = 'ffmpeg exited with code 1') => describeTranscodeFailure(new TranscodeError(msg, stderr), opts);

test('a timeout is reported as a timeout, whatever else is in the log', () => {
  const f = describeTranscodeFailure(new TranscodeError('ffmpeg was killed with signal SIGKILL', 'Invalid data', true));
  assert.equal(f.code, 'PROCESSING_TIMEOUT');
  assert.equal(f.status, 504);
});

test('a full disk is a server-side fault', () => {
  const f = classify('av_interleaved_write_frame(): No space left on device');
  assert.equal(f.code, 'SERVER_STORAGE_FULL');
  assert.equal(f.status, 507);
  assert.equal(f.serverSide, true);
  assert.equal(describeTranscodeFailure(Object.assign(new Error('write failed'), { code: 'ENOSPC' })).code, 'SERVER_STORAGE_FULL');
});

test('a missing ffmpeg binary is a server-side fault', () => {
  const f = describeTranscodeFailure(new Error('Cannot find ffmpeg'));
  assert.equal(f.code, 'SERVER_PROCESSING_UNAVAILABLE');
  assert.equal(f.serverSide, true);
});

test('out of memory / killed is a server-side fault', () => {
  assert.equal(classify('Cannot allocate memory').code, 'SERVER_OUT_OF_MEMORY');
  assert.equal(describeTranscodeFailure(new Error('ffmpeg was killed with signal SIGKILL')).code, 'SERVER_OUT_OF_MEMORY');
  assert.equal(classify('Error: room not found').code, 'PROCESSING_FAILED'); // "oom" inside another word must not match
});

test('damaged and truncated files are reported as such', () => {
  assert.equal(classify('moov atom not found\nx.mp4: Invalid data found when processing input').code, 'VIDEO_CORRUPT');
  assert.equal(classify('Invalid data found when processing input').status, 422);
});

test('a file with no video track and an unreadable codec get their own causes', () => {
  assert.equal(classify("Output file #0 does not contain any stream").code, 'NO_VIDEO_STREAM');
  assert.equal(classify('Decoder (codec prores_ks) not found for input stream #0:0').code, 'UNSUPPORTED_CODEC');
});

test('an unclassified failure blames the added audio only when audio was added', () => {
  assert.equal(classify('something odd', { withAudio: true }).code, 'AUDIO_FAILED');
  assert.equal(classify('something odd', { withAudio: false }).code, 'PROCESSING_FAILED');
  // …but a damaged video is still reported as damaged even with audio attached
  assert.equal(classify('moov atom not found', { withAudio: true }).code, 'VIDEO_CORRUPT');
});

test('the reason is the last error-looking line, trimmed', () => {
  assert.equal(lastReason('frame=1\nsome info\nError opening input: boom\n'), 'Error opening input: boom');
  assert.equal(lastReason(''), null);
  assert.ok(lastReason('x'.repeat(500)).length <= 200);
});

test('reference ids are short and differ', () => {
  const a = referenceId();
  assert.match(a, /^[A-Z0-9]{1,6}$/);
  assert.notEqual(a, referenceId());
});
