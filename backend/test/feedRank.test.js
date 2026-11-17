const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rankVideos, encodeRankCursor, decodeRankCursor, EMPTY_SIGNALS } = require('../dist/lib/feedRank');

const NOW = Date.parse('2026-11-16T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000);
const vid = (id, h, extra = {}) => ({ id, createdAt: hoursAgo(h), likes: 0, views: 0, comments: 0, shares: 0, hashtags: [], uploaderSessionId: `u-${id}`, ...extra });
const signals = (over) => ({ ...EMPTY_SIGNALS, viewedIds: new Set(), followingSessionIds: new Set(), tagWeights: new Map(), creatorWeights: new Map(), locationWeights: new Map(), ...over });

test('already-watched videos sink behind unseen ones', () => {
  const vids = [vid('a', 1), vid('b', 2), vid('c', 3)];
  const out = rankVideos(vids, signals({ viewedIds: new Set(['a']) }), NOW).map((v) => v.id);
  assert.equal(out[out.length - 1], 'a');
});

test('followed creators and liked hashtags outrank slightly newer videos', () => {
  const vids = [vid('new', 1), vid('followed', 30, { uploaderSessionId: 'f' }), vid('tagged', 30, { hashtags: ['shoes'] })];
  const out = rankVideos(vids, signals({ followingSessionIds: new Set(['f']), tagWeights: new Map([['shoes', 3]]) }), NOW).map((v) => v.id);
  assert.equal(out[0], 'followed');
  assert.ok(out.indexOf('tagged') < out.indexOf('new') || out.indexOf('followed') === 0);
});

test('different viewers get different orders', () => {
  const vids = [vid('a', 5, { hashtags: ['cars'] }), vid('b', 5, { hashtags: ['shoes'] })];
  const cars = rankVideos(vids, signals({ tagWeights: new Map([['cars', 2]]) }), NOW)[0].id;
  const shoes = rankVideos(vids, signals({ tagWeights: new Map([['shoes', 2]]) }), NOW)[0].id;
  assert.equal(cars, 'a');
  assert.equal(shoes, 'b');
});

test('ranking is a permutation (nothing dropped or duplicated)', () => {
  const vids = Array.from({ length: 30 }, (_, i) => vid(`v${i}`, i * 3, { uploaderSessionId: i % 2 ? 'x' : 'y' }));
  const out = rankVideos(vids, EMPTY_SIGNALS, NOW);
  assert.equal(new Set(out.map((v) => v.id)).size, 30);
});

test('same creator is not shown back to back when alternatives exist', () => {
  const vids = [vid('a1', 1, { uploaderSessionId: 'a' }), vid('a2', 2, { uploaderSessionId: 'a' }), vid('b1', 3, { uploaderSessionId: 'b' })];
  const out = rankVideos(vids, EMPTY_SIGNALS, NOW);
  assert.notEqual(out[0].uploaderSessionId, out[1].uploaderSessionId);
});

test('rank cursor round-trips and rejects chronological cursors', () => {
  assert.equal(decodeRankCursor(encodeRankCursor(40)), 40);
  assert.equal(decodeRankCursor('1700000000000_abc'), null);
  assert.equal(decodeRankCursor(undefined), null);
});

test('videos from the viewer\'s own location rank higher', () => {
  const vids = [vid('far', 2, { locationId: 'mbale' }), vid('near', 6, { locationId: 'kampala' })];
  const out = rankVideos(vids, signals({ locationId: 'kampala' }), NOW).map((v) => v.id);
  assert.equal(out[0], 'near');
});
