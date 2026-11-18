const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sampleTimes } = require('../dist/lib/frames.js');

test('sample times: evenly spread, bounded, empty for bad lengths', () => {
  assert.deepEqual(sampleTimes(4), [2]);
  assert.deepEqual(sampleTimes(10), [2.5, 7.5]);
  assert.equal(sampleTimes(60).length, 4);
  const t = sampleTimes(60);
  assert.ok(t.every((x, i) => x > 0 && x < 60 && (i === 0 || x > t[i - 1])));
  assert.deepEqual(sampleTimes(0), []);
  assert.deepEqual(sampleTimes(NaN), []);
});
