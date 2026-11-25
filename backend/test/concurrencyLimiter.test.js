// Tests for backend/src/lib/concurrencyLimiter.ts — at most N jobs at once, the rest queued in order.
// Run with: npm test (after `npm run build`).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLimiter } = require('../dist/lib/concurrencyLimiter.js');

const gate = () => {
  let open;
  const promise = new Promise((r) => (open = r));
  return { promise, open };
};
const tick = () => new Promise((r) => setImmediate(r));

test('never runs more than the limit at once, and starts queued jobs as slots free up', async () => {
  const limiter = createLimiter(2);
  const gates = [gate(), gate(), gate(), gate()];
  const started = [];
  const jobs = gates.map((g, i) => limiter.run(async () => { started.push(i); await g.promise; return i; }));
  await tick();
  assert.deepEqual(started, [0, 1]);
  assert.equal(limiter.active, 2);
  assert.equal(limiter.queued, 2);
  gates[0].open();
  await tick();
  assert.deepEqual(started, [0, 1, 2]); // first come, first served
  gates[1].open(); gates[2].open();
  await tick();
  assert.deepEqual(started, [0, 1, 2, 3]);
  gates[3].open();
  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3]);
  assert.equal(limiter.active, 0);
  assert.equal(limiter.queued, 0);
});

test('a failing job frees its slot and reports its error', async () => {
  const limiter = createLimiter(1);
  await assert.rejects(limiter.run(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(limiter.active, 0);
  assert.equal(await limiter.run(async () => 'ok'), 'ok'); // the next job is not stuck behind the failure
});

test('a nonsensical limit still lets work through (at least one at a time)', async () => {
  for (const bad of [0, -3, NaN]) {
    assert.equal(await createLimiter(bad).run(async () => 'ran'), 'ran');
  }
});
