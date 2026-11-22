import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEventQueue } from '../src/lib/eventQueue.ts';

const tick = () => new Promise((r) => setTimeout(r, 5));

test('events are sent in order, in batches no larger than maxBatch', async () => {
  const sent = [];
  const q = createEventQueue({ send: async (b) => void sent.push(b), maxBatch: 3 });
  for (let i = 1; i <= 7; i++) q.push(i);
  await tick(); await q.flush(); await q.flush();
  assert.deepEqual(sent.flat(), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(sent.every((b) => b.length <= 3));
  assert.equal(q.size(), 0);
});

test('a failed send keeps the events (at the front) and delivers them on the next flush', async () => {
  let fail = true; const sent = [];
  const q = createEventQueue({ send: async (b) => { if (fail) throw new Error('offline'); sent.push(...b); }, maxBatch: 10 });
  q.push('a'); q.push('b');
  await q.flush();
  assert.equal(q.size(), 2);
  q.push('c');
  fail = false;
  await q.flush();
  assert.deepEqual(sent, ['a', 'b', 'c']);
});

test('only one send is in flight at a time (no duplicate delivery on overlapping flushes)', async () => {
  let inFlight = 0, maxSeen = 0; const sent = [];
  const q = createEventQueue({ send: async (b) => { inFlight++; maxSeen = Math.max(maxSeen, inFlight); await tick(); sent.push(...b); inFlight--; }, maxBatch: 50 });
  q.push(1); q.push(2);
  await Promise.all([q.flush(), q.flush(), q.flush()]);
  assert.equal(maxSeen, 1);
  assert.deepEqual(sent, [1, 2]);
});

test('a long offline stretch drops the OLDEST events instead of growing without bound', async () => {
  const q = createEventQueue({ send: async () => { throw new Error('offline'); }, maxBatch: 1000, maxBuffer: 5 });
  for (let i = 1; i <= 12; i++) q.push(i);
  assert.equal(q.size(), 5);
  let got = [];
  const q2 = createEventQueue({ send: async (b) => void got.push(...b), maxBatch: 1000, maxBuffer: 5 });
  for (let i = 1; i <= 12; i++) q2.push(i);
  await q2.flush();
  assert.deepEqual(got, [8, 9, 10, 11, 12]);
});

test('auto-flush sends on a timer and stops when asked', async () => {
  const sent = [];
  const q = createEventQueue({ send: async (b) => void sent.push(...b), maxBatch: 100 });
  const stop = q.startAutoFlush(15);
  q.push('x');
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(sent, ['x']);
  stop();
  q.push('y');
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(sent, ['x']); // timer is stopped
  await q.flush();
  assert.deepEqual(sent, ['x', 'y']);
});

test('push never throws and send errors never escape', async () => {
  const q = createEventQueue({ send: async () => { throw new TypeError('boom'); } });
  assert.doesNotThrow(() => q.push(1));
  await assert.doesNotReject(() => q.flush());
});
