import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions, initialPromptState, tickPrompt } from '../src/lib/guestPrompt.ts';

const cfg = { enabled: true, firstAfterSeconds: 20, baseGapSeconds: 60, backoff: 1.6, maxPerSession: 5, autoHideSeconds: 12 };
const run = (n, c = cfg) => {
  let s = initialPromptState();
  const at = [];
  for (let i = 1; i <= n; i++) {
    const r = tickPrompt(s, c);
    s = r.state;
    if (r.show) at.push(i);
  }
  return at;
};

test('guests watch first: no prompt before the first threshold, then back-off gaps', () => {
  assert.deepEqual(run(19), []);
  assert.deepEqual(run(400).slice(0, 3), [20, 80, 176]);
});

test('respects the admin switches: disabled, max count, custom timing', () => {
  assert.deepEqual(run(1000, { ...cfg, enabled: false }), []);
  assert.equal(run(100000).length, 5);
  assert.deepEqual(run(100, { ...cfg, firstAfterSeconds: 45, baseGapSeconds: 10, backoff: 1, maxPerSession: 2 }), [45, 55]);
});

test('versions compare numerically', () => {
  assert.equal(compareVersions('1.10.0', '1.9.2'), 1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
});
