const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encodeCursor, decodeCursor, olderThan } = require('../dist/lib/core/cursor');

test('cursor round-trips createdAt (to the millisecond) and id', () => {
  const d = new Date('2026-11-16T10:20:30.123Z');
  const c = decodeCursor(encodeCursor(d, 'cm0abc123'));
  assert.equal(c.id, 'cm0abc123');
  assert.equal(c.createdAt.getTime(), d.getTime());
});

test('legacy / malformed cursors are rejected instead of throwing', () => {
  for (const bad of [undefined, null, '', 'cm0abc123', '_id', '123_', 'abc_def', '-5_x', {}, 42]) {
    assert.equal(decodeCursor(bad), null, String(bad));
  }
});

test('olderThan selects strictly older rows and breaks createdAt ties by id', () => {
  const cur = { createdAt: new Date(1000), id: 'm' };
  assert.deepEqual(olderThan(cur), { OR: [{ createdAt: { lt: cur.createdAt } }, { createdAt: cur.createdAt, id: { lt: 'm' } }] });
});
