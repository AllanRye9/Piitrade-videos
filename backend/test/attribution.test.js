const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../dist/lib/attribution.js');
const F = require('../dist/lib/feedRank.js');

test('redirect URL adds utm + click token without overriding existing params', () => {
  const u = new URL(A.buildRedirectUrl('https://shop.example/listings/1?utm_source=mine&color=red', 'tok123', 'vid1', 'yotweek'));
  assert.equal(u.searchParams.get('utm_source'), 'mine');
  assert.equal(u.searchParams.get('utm_medium'), 'video');
  assert.equal(u.searchParams.get('utm_campaign'), 'video-vid1');
  assert.equal(u.searchParams.get('color'), 'red');
  assert.equal(u.searchParams.get('yw_click'), 'tok123');
});

test('a stale click token in the stored link is replaced, not duplicated', () => {
  const u = new URL(A.buildRedirectUrl('https://shop.example/p?yw_click=old', 'new', 'v', 'x'));
  assert.deepEqual(u.searchParams.getAll('yw_click'), ['new']);
});

test('tokens are unique and url-safe', () => {
  const a = A.generateClickToken(), b = A.generateClickToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{20,}$/);
});

test('signature: valid, bare hex, wrong secret, tampered body, malformed', () => {
  const body = Buffer.from('{"click":"t","orderId":"1","amount":5}');
  const sig = A.signBody('s3cret', body);
  assert.equal(A.verifySignature('s3cret', body, `sha256=${sig}`), true);
  assert.equal(A.verifySignature('s3cret', body, sig.toUpperCase()), true);
  assert.equal(A.verifySignature('other', body, sig), false);
  assert.equal(A.verifySignature('s3cret', Buffer.from('{"click":"t","orderId":"1","amount":6}'), sig), false);
  assert.equal(A.verifySignature('s3cret', body, 'nope'), false);
  assert.equal(A.verifySignature('s3cret', body, undefined), false);
  assert.equal(A.verifySignature('', body, sig), false); // a site with no secret can never verify
});

test('amounts become whole minor units and bad ones are rejected', () => {
  assert.equal(A.toMinor(12.5), 1250);
  assert.equal(A.toMinor('49.99'), 4999);
  assert.equal(A.toMinor(0), 0);
  assert.equal(A.toMinor(19.99 * 3), 5997); // float noise rounds away
  for (const bad of [-1, 'abc', NaN, Infinity, null, undefined, 1e12]) assert.equal(A.toMinor(bad), null);
});

test('commission rounds, clamps and is zero without a rate', () => {
  assert.equal(A.commissionFor(10000, 10), 1000);
  assert.equal(A.commissionFor(999, 7.5), 75);
  assert.equal(A.commissionFor(10000, 250), 10000);
  for (const p of [0, -3, undefined, null, NaN]) assert.equal(A.commissionFor(10000, p), 0);
});

test('ledger status transitions', () => {
  assert.equal(A.canTransition('pending', 'approved'), true);
  assert.equal(A.canTransition('pending', 'reversed'), true);
  assert.equal(A.canTransition('approved', 'paid'), true);
  assert.equal(A.canTransition('approved', 'reversed'), true);
  assert.equal(A.canTransition('pending', 'paid'), false); // must be approved first
  assert.equal(A.canTransition('paid', 'reversed'), false);
  assert.equal(A.canTransition('reversed', 'approved'), false);
  assert.equal(A.canTransition('bogus', 'paid'), false);
});

test('currency codes are validated; blank is allowed (site default applies)', () => {
  assert.equal(A.validCurrency('ugx'), 'UGX');
  assert.equal(A.validCurrency(''), '');
  assert.equal(A.validCurrency(undefined), '');
  assert.equal(A.validCurrency('US'), null);
  assert.equal(A.validCurrency('US$'), null);
});

test('balances sum per currency and ignore reversed entries', () => {
  const out = A.sumByCurrency([
    { currency: 'USD', status: 'pending', commissionMinor: 100 },
    { currency: 'USD', status: 'approved', commissionMinor: 250 },
    { currency: 'USD', status: 'paid', commissionMinor: 400 },
    { currency: 'USD', status: 'reversed', commissionMinor: 9999 },
    { currency: 'UGX', status: 'pending', commissionMinor: 5 },
    { currency: '', status: 'pending', commissionMinor: 1 },
  ]);
  assert.deepEqual(out.USD, { pending: 100, approved: 250, paid: 400 });
  assert.deepEqual(out.UGX, { pending: 5, approved: 0, paid: 0 });
  assert.equal(out['—'].pending, 1);
});

test('the viewer hash is stable within a day, differs across days and viewers, and hides the IP', () => {
  const d1 = new Date('2026-01-01T10:00:00Z'), d2 = new Date('2026-01-02T10:00:00Z');
  const a = A.viewerHash('1.2.3.4', 'UA', 'k', d1);
  assert.equal(a, A.viewerHash('1.2.3.4', 'UA', 'k', new Date('2026-01-01T23:00:00Z')));
  assert.notEqual(a, A.viewerHash('1.2.3.4', 'UA', 'k', d2));
  assert.notEqual(a, A.viewerHash('1.2.3.5', 'UA', 'k', d1));
  assert.ok(!a.includes('1.2.3.4'));
});

test('feed: sell rate is zero without sales and rewards proven sellers over lucky ones', () => {
  assert.equal(F.sellRate({ id: 'a', createdAt: new Date() }), 0);
  assert.equal(F.sellRate({ id: 'a', createdAt: new Date(), clicks: 50, conversions: 0 }), 0);
  const proven = F.sellRate({ id: 'a', createdAt: new Date(), clicks: 100, conversions: 20 });
  const lucky = F.sellRate({ id: 'b', createdAt: new Date(), clicks: 1, conversions: 1 });
  assert.ok(proven > lucky);
});

test('feed: a video that sells ranks above an otherwise identical one', () => {
  const now = Date.now();
  const mk = (id, extra = {}) => ({ id, createdAt: new Date(now - 3600_000), likes: 5, views: 50, comments: 1, shares: 0, ...extra });
  const ranked = F.rankVideos([mk('plain'), mk('seller', { clicks: 40, conversions: 8 })], F.EMPTY_SIGNALS, now);
  assert.equal(ranked[0].id, 'seller');
});
