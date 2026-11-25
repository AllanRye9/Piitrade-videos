// Tests for describeUploadFailure (net.ts) and pollUploadStatus (uploadPoll.ts): an upload that fails now says
// why, and one whose connection died after the file was sent is checked instead of re-uploaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeUploadFailure, MAX_UPLOAD_MB, UPLOAD_MESSAGES } from '../src/lib/uploadErrors.ts';
import { pollUploadStatus } from '../src/lib/uploadPoll.ts';

test('the server\'s own message always wins — it states the real cause', () => {
  const f = describeUploadFailure({ status: 422, serverMessage: 'This video file looks damaged (ref ABC123)', sent: true });
  assert.equal(f.message, 'This video file looks damaged (ref ABC123)');
  assert.equal(f.recoverable, false);
});

test('a proxy 413 without a body says the file is too large and names the limit', () => {
  const f = describeUploadFailure({ status: 413, sent: false });
  assert.equal(f.message, UPLOAD_MESSAGES.tooLarge);
  assert.ok(f.message.includes(String(MAX_UPLOAD_MB)));
});

test('a gateway timeout is recoverable — the video may still be processing', () => {
  for (const status of [502, 504, 524]) {
    const f = describeUploadFailure({ status, sent: true });
    assert.equal(f.recoverable, true, String(status));
  }
  // an HTML error page's text is not a usable message: gateway codes ignore it
  assert.equal(describeUploadFailure({ status: 504, serverMessage: 'Gateway Time-out', sent: true }).recoverable, true);
});

test('a dropped connection is recoverable only if the whole file had been sent', () => {
  assert.equal(describeUploadFailure({ status: 0, sent: true }).recoverable, true);
  const before = describeUploadFailure({ status: 0, sent: false });
  assert.equal(before.recoverable, false);
  assert.equal(before.message, UPLOAD_MESSAGES.lostBeforeSent);
});

test('a timeout while still sending says the connection is too slow', () => {
  const f = describeUploadFailure({ status: 0, sent: false, timedOut: true });
  assert.equal(f.message, UPLOAD_MESSAGES.slow);
  assert.equal(f.recoverable, false);
  assert.equal(describeUploadFailure({ status: 0, sent: true, timedOut: true }).recoverable, true);
});

test('other server errors state the status code', () => {
  assert.equal(describeUploadFailure({ status: 503, sent: true }).message, UPLOAD_MESSAGES.busy);
  assert.ok(describeUploadFailure({ status: 500, sent: true }).message.includes('500'));
});

// ---- pollUploadStatus ----
const fast = () => {
  let t = 0;
  return { sleep: async (ms) => { t += ms; }, now: () => t };
};

test('polling returns the video as soon as the server has it', async () => {
  const replies = [{ status: 'processing' }, { status: 'processing' }, { status: 'done', video: { id: 'v1' } }];
  const v = await pollUploadStatus(async () => replies.shift(), { ...fast(), intervalMs: 1000, maxMs: 60_000 });
  assert.deepEqual(v, { id: 'v1' });
});

test('polling tolerates network errors and keeps asking', async () => {
  let n = 0;
  const v = await pollUploadStatus(async () => {
    if (++n < 3) throw new TypeError('Network request failed');
    return { status: 'done', video: { id: 'v2' } };
  }, { ...fast(), intervalMs: 1000, maxMs: 60_000 });
  assert.deepEqual(v, { id: 'v2' });
});

test('a server that never heard of the upload is given a grace period, then abandoned', async () => {
  let calls = 0;
  const v = await pollUploadStatus(async () => { calls++; return { status: 'unknown' }; }, { ...fast(), intervalMs: 5000, graceMs: 30_000, maxMs: 600_000 });
  assert.equal(v, null);
  assert.ok(calls >= 6 && calls <= 8, `calls=${calls}`);
});

test('an upload that was processing and then vanished (encode failed) is abandoned quickly', async () => {
  const replies = [{ status: 'processing' }, { status: 'unknown' }, { status: 'unknown' }];
  let calls = 0;
  const v = await pollUploadStatus(async () => { calls++; return replies.shift() ?? { status: 'unknown' }; }, { ...fast(), intervalMs: 5000, graceMs: 600_000, maxMs: 600_000 });
  assert.equal(v, null);
  assert.equal(calls, 3);
});

test('polling gives up at the deadline even if the server keeps saying processing', async () => {
  const v = await pollUploadStatus(async () => ({ status: 'processing' }), { ...fast(), intervalMs: 5000, maxMs: 60_000 });
  assert.equal(v, null);
});
