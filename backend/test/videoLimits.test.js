// Tests for backend/src/lib/videoLimits.ts — the 60-second cap and the
// trim-window rules behind the upload dialog's trim editor. Pure logic
// (no ffmpeg/DB), so these run anywhere.
//
// Run with: npm test  (after `npm run build` — this requires dist/).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MAX_VIDEO_SECONDS, resolveTrimWindow, withinLimit } = require('../dist/lib/videoLimits.js');
const { HttpError } = require('../dist/lib/httpError.js');

function expectError(fn, code, status = 400) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof HttpError, 'expected an HttpError');
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    return err;
  }
  assert.fail(`expected HttpError with code ${code}`);
}

test('the cap is 60 seconds', () => {
  assert.equal(MAX_VIDEO_SECONDS, 60);
});

test('a video at or under 60s with no trim is kept whole', () => {
  assert.deepEqual(resolveTrimWindow(12.5), { start: 0, length: 12.5, trimmed: false });
  assert.deepEqual(resolveTrimWindow(60), { start: 0, length: 60, trimmed: false });
});

test('a video over 60s with no trim is rejected with VIDEO_TOO_LONG and the real duration', () => {
  const err = expectError(() => resolveTrimWindow(130), 'VIDEO_TOO_LONG');
  assert.equal(err.details.duration, 130);
  assert.equal(err.details.maxSeconds, 60);
});

test('trimming a long video down to exactly 60s is accepted', () => {
  assert.deepEqual(resolveTrimWindow(130, '10', '70'), { start: 10, length: 60, trimmed: true });
});

test('trimming to less than 60s is accepted', () => {
  assert.deepEqual(resolveTrimWindow(74, 5, 12), { start: 5, length: 7, trimmed: true });
});

test('a trim window longer than 60s is rejected, never silently shortened', () => {
  expectError(() => resolveTrimWindow(130, 0, 75), 'VIDEO_TOO_LONG');
});

test('an end past the source is clamped, so "60s from here" works when the client cannot know the duration', () => {
  assert.deepEqual(resolveTrimWindow(80, 40, 100), { start: 40, length: 40, trimmed: true });
  // start only: keep from there to the end if that fits
  assert.deepEqual(resolveTrimWindow(80, 30), { start: 30, length: 50, trimmed: true });
});

test('start only on a long video that still leaves more than 60s is rejected', () => {
  expectError(() => resolveTrimWindow(130, 10), 'VIDEO_TOO_LONG');
});

test('trimming a short video is allowed but a no-op trim reports trimmed: false', () => {
  assert.equal(resolveTrimWindow(20, 0, 20).trimmed, false);
  assert.equal(resolveTrimWindow(20, 2, 18).trimmed, true);
});

test('invalid trim points are rejected', () => {
  expectError(() => resolveTrimWindow(74, 'abc', 10), 'INVALID_TRIM');
  expectError(() => resolveTrimWindow(74, -3, 10), 'INVALID_TRIM');
  expectError(() => resolveTrimWindow(74, 80, 90), 'INVALID_TRIM');
  expectError(() => resolveTrimWindow(74, 10, 10), 'INVALID_TRIM');
  expectError(() => resolveTrimWindow(74, 10, 10.2), 'INVALID_TRIM'); // shorter than the 1s minimum
});

test('tiny float overshoot from a client is tolerated', () => {
  assert.equal(resolveTrimWindow(130, 10, 70.04).length, 60);
});

test('withinLimit allows a small encoder overshoot but nothing meaningful', () => {
  assert.equal(withinLimit(60), true);
  assert.equal(withinLimit(60.3), true);
  assert.equal(withinLimit(61), false);
  assert.equal(withinLimit(120), false);
});
