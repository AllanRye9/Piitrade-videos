import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchWithTimeout, OFFLINE_MESSAGE, TIMEOUT_MESSAGE } from '../src/lib/net.ts';

// A fetch that never answers on its own — only rejects when its signal aborts (like a stalled connection).
// Like the real fetch: rejects at once if the signal is already aborted, otherwise when it aborts later.
const hang = (_url, init) =>
  new Promise((_res, rej) => {
    const fail = () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (init.signal.aborted) return fail();
    init.signal.addEventListener('abort', fail, { once: true });
  });
const ok = async () => new Response('{"ok":true}', { status: 200 });

test('a stalled request is cut off with a readable timeout error instead of hanging forever', async () => {
  const started = Date.now();
  await assert.rejects(() => fetchWithTimeout(hang, 'http://x', {}, 60), { message: TIMEOUT_MESSAGE });
  assert.ok(Date.now() - started < 1000);
});

test('offline (fetch rejects with TypeError) becomes a friendly message', async () => {
  const offline = async () => { throw new TypeError('Network request failed'); };
  await assert.rejects(() => fetchWithTimeout(offline, 'http://x', {}, 1000), { message: OFFLINE_MESSAGE });
});

test('a normal response passes straight through', async () => {
  const res = await fetchWithTimeout(ok, 'http://x', { method: 'POST' }, 1000);
  assert.deepEqual(await res.json(), { ok: true });
});

test('the request receives an abort signal and the original options', async () => {
  let seen;
  await fetchWithTimeout(async (url, init) => { seen = { url, init }; return new Response('{}'); }, 'http://x/y', { method: 'PUT', headers: { a: '1' } }, 1000);
  assert.equal(seen.url, 'http://x/y');
  assert.equal(seen.init.method, 'PUT');
  assert.ok(seen.init.signal instanceof AbortSignal);
});

test('a deliberate cancel by the caller is NOT reported as a timeout or offline', async () => {
  const c = new AbortController();
  const p = fetchWithTimeout(hang, 'http://x', { signal: c.signal }, 5000);
  c.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
  const pre = new AbortController(); pre.abort();
  await assert.rejects(() => fetchWithTimeout(hang, 'http://x', { signal: pre.signal }, 5000), (e) => e.name === 'AbortError');
});

test('non-network errors are left alone, and no timer is left running after success', async () => {
  const boom = async () => { throw new RangeError('boom'); };
  await assert.rejects(() => fetchWithTimeout(boom, 'http://x', {}, 1000), RangeError);
  // If the 20s timer leaked, this test file would hang past the runner's timeout instead of exiting.
  await fetchWithTimeout(ok, 'http://x', {}, 20_000);
});

import { NetworkError, isNetworkError } from '../src/lib/net.ts';
import { networkStore, setOffline } from '../src/state/network.ts';

test('timeouts and offline failures are typed NetworkErrors (so screens can tell them from server errors)', async () => {
  const offline = async () => { throw new TypeError('Network request failed'); };
  const e1 = await fetchWithTimeout(offline, 'http://x', {}, 1000).catch((e) => e);
  assert.ok(isNetworkError(e1) && e1 instanceof NetworkError && e1.kind === 'offline');
  const e2 = await fetchWithTimeout(hang, 'http://x', {}, 40).catch((e) => e);
  assert.ok(isNetworkError(e2) && e2.kind === 'timeout');
  assert.ok(!isNetworkError(new Error('Request failed: 500')));
  assert.ok(!isNetworkError(new RangeError('x')));
});

test('an HTTP error status is a response, not a network failure', async () => {
  const res = await fetchWithTimeout(async () => new Response('{"error":"nope"}', { status: 500 }), 'http://x', {}, 1000);
  assert.equal(res.status, 500); // resolves normally; api.ts treats any answer as "online"
});

test('connectivity store: starts online, notifies only on real changes, unsubscribes cleanly', () => {
  assert.equal(networkStore.isOffline(), false);
  let calls = 0;
  const off = networkStore.subscribe(() => calls++);
  setOffline(false); assert.equal(calls, 0);          // no change → no re-render storm on every successful request
  setOffline(true);  assert.equal(calls, 1); assert.equal(networkStore.isOffline(), true);
  setOffline(true);  assert.equal(calls, 1);
  setOffline(false); assert.equal(calls, 2); assert.equal(networkStore.isOffline(), false);
  off(); setOffline(true); assert.equal(calls, 2);    // unsubscribed
  setOffline(false);
});
