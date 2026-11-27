const { test } = require('node:test');
const assert = require('node:assert/strict');
const dbPath = require.resolve('../dist/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: {} } };
const G = require('../dist/lib/feed/guardrail');

// Deterministic pseudo-random so the statistical tests never flake.
function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); }
function cohortFrom(fracs) {
  return G.summarize({ sessions: fracs.length, completions: fracs.filter((f) => f >= 0.9).length, sumWatchMs: fracs.reduce((a, f) => a + f * 10000, 0), sumFrac: fracs.reduce((a, f) => a + f, 0), sumFracSq: fracs.reduce((a, f) => a + f * f, 0) });
}
const sample = (n, mean, seed) => { const r = rng(seed); return Array.from({ length: n }, () => Math.min(1, Math.max(0, mean + (r() - 0.5) * 0.6))); };

test('summarize computes mean, sd, completion rate and average watch seconds', () => {
  const s = cohortFrom([0.2, 0.4, 0.6, 1]);
  assert.equal(s.sessions, 4);
  assert.ok(Math.abs(s.watchThrough - 0.55) < 1e-9);
  assert.ok(Math.abs(s.sd - Math.sqrt(((0.35 ** 2) + (0.15 ** 2) + (0.05 ** 2) + (0.45 ** 2)) / 3)) < 1e-9);
  assert.equal(s.completionRate, 0.25);
  assert.ok(Math.abs(s.avgWatchSec - 5.5) < 1e-9);
  assert.deepEqual(G.summarize({ sessions: 0, completions: 0, sumWatchMs: 0, sumFrac: 0, sumFracSq: 0 }).sessions, 0);
});

test('normalCdf matches known values', () => {
  assert.ok(Math.abs(G.normalCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(G.normalCdf(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(G.normalCdf(-1.96) - 0.025) < 1e-3);
});

test('too little data → no verdict (never guesses)', () => {
  const c = G.compare(cohortFrom(sample(50, 0.6, 1)), cohortFrom(sample(50, 0.6, 2)));
  assert.equal(c.verdict, 'insufficient_data');
});

test('identical populations → no harm', () => {
  const c = G.compare(cohortFrom(sample(5000, 0.6, 11)), cohortFrom(sample(5000, 0.6, 12)));
  assert.equal(c.verdict, 'no_harm');
  assert.ok(Math.abs(c.deltaWatchThrough) < 0.01);
  assert.ok(c.ci95[0] < 0 && c.ci95[1] > 0); // interval straddles zero
});

test('a real drop in watch-through is flagged as harm, with a CI below zero', () => {
  const c = G.compare(cohortFrom(sample(5000, 0.52, 21)), cohortFrom(sample(5000, 0.6, 22)));
  assert.equal(c.verdict, 'harm');
  assert.ok(c.deltaWatchThrough < -0.05 && c.ci95[1] < 0 && c.pValue < 0.05);
});

test('a real gain is reported as benefit', () => {
  assert.equal(G.compare(cohortFrom(sample(5000, 0.66, 31)), cohortFrom(sample(5000, 0.6, 32))).verdict, 'benefit');
});

test('a significant but immaterial difference (<1 point) is NOT called harm', () => {
  const huge = (m, seed) => cohortFrom(sample(200000, m, seed));
  const c = G.compare(huge(0.595, 41), huge(0.6, 42));
  assert.notEqual(c.verdict, 'harm');
});

test('inHoldout is stable per session, off at 0%, never for anonymous, and ≈ the configured share', () => {
  assert.equal(G.inHoldout('s-1', 5), G.inHoldout('s-1', 5));
  assert.equal(G.inHoldout('anonymous', 50), false);
  assert.equal(G.inHoldout('', 50), false);
  let held = 0, off = 0;
  for (let i = 0; i < 20000; i++) { if (G.inHoldout(`session-${i}`, 5)) held++; if (G.inHoldout(`session-${i}`, 0)) off++; }
  assert.equal(off, 0);
  assert.ok(held > 20000 * 0.04 && held < 20000 * 0.06, `held ${held}`);
  // raising the % only ADDS viewers to the hold-out (nobody flips back and forth when you tune it)
  for (let i = 0; i < 2000; i++) if (G.inHoldout(`session-${i}`, 5)) assert.ok(G.inHoldout(`session-${i}`, 10));
});

test('holdoutPct reads CHIP_HOLDOUT_PCT and clamps it', () => {
  const old = process.env.CHIP_HOLDOUT_PCT;
  process.env.CHIP_HOLDOUT_PCT = '80'; assert.equal(G.holdoutPct(), 50);
  process.env.CHIP_HOLDOUT_PCT = '-3'; assert.equal(G.holdoutPct(), 0);
  process.env.CHIP_HOLDOUT_PCT = 'abc'; assert.equal(G.holdoutPct(), 5);
  delete process.env.CHIP_HOLDOUT_PCT; assert.equal(G.holdoutPct(), 5);
  if (old !== undefined) process.env.CHIP_HOLDOUT_PCT = old;
});

test('parseEvents keeps good events, drops junk, caps the batch', () => {
  const ev = G.parseEvents({ events: [
    { type: 'watch', videoId: 'v1', watchedMs: 4000, durationMs: 10000 },
    { type: 'watch', videoId: 'v1', watchedMs: -5 }, { type: 'watch', videoId: '', watchedMs: 1 }, { type: 'watch', videoId: 'v1', watchedMs: 'x' },
    { type: 'chip', videoId: 'v1', productId: 'p1' }, { type: 'chip', videoId: 'v1' }, { type: 'nope', videoId: 'v1' }, null, 42,
  ] });
  assert.deepEqual(ev.map((e) => e.type), ['watch', 'chip']);
  assert.equal(G.parseEvents({}).length, 0);
  assert.equal(G.parseEvents({ events: Array.from({ length: 500 }, () => ({ type: 'chip', videoId: 'v', productId: 'p' })) }).length, G.MAX_EVENTS_PER_REQUEST);
  assert.equal(G.parseEvents({ events: [{ type: 'watch', videoId: 'v', watchedMs: 9e12 }] })[0].watchedMs, 6 * 3600 * 1000);
});

test('watchFacts caps looping at 100%, prefers the server duration, marks completion at 90%', () => {
  assert.deepEqual(G.watchFacts(30000, 10, undefined), { frac: 1, completed: true, watchMs: 30000 });
  assert.equal(G.watchFacts(5000, 10, 99999).frac, 0.5);          // server duration wins over a client claim
  assert.equal(G.watchFacts(9000, 10, undefined).completed, true);
  assert.equal(G.watchFacts(8900, 10, undefined).completed, false);
  assert.equal(G.watchFacts(5000, null, 20000).frac, 0.25);       // client duration only when the server has none
  assert.equal(G.watchFacts(5000, null, undefined), null);
});

test('utcDay is midnight UTC', () => {
  assert.equal(G.utcDay(new Date('2026-11-21T23:59:59Z')).toISOString(), '2026-11-21T00:00:00.000Z');
});
