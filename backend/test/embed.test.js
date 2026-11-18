const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../dist/lib/embed.js');
const U = require('../dist/lib/siteUrls.js');

test('oEmbed size: defaults, maxwidth, maxheight and caps', () => {
  assert.deepEqual(E.oembedSize(), { width: 360, height: 640 });
  assert.deepEqual(E.oembedSize(180), { width: 180, height: 320 });
  assert.deepEqual(E.oembedSize(5000), { width: 600, height: 1067 });
  const tall = E.oembedSize(360, 400);
  assert.equal(tall.height, 400);
  assert.ok(tall.width <= 360 && Math.abs(tall.width / tall.height - 9 / 16) < 0.01);
  assert.ok(E.oembedSize(10).width >= 120);
});

test('parseVideoUrl accepts /v and /embed links on our origins only', () => {
  const origins = ['https://videos.example.com', ''];
  assert.equal(E.parseVideoUrl('https://videos.example.com/v/abc123', origins), 'abc123');
  assert.equal(E.parseVideoUrl('https://videos.example.com/embed/abc123/', origins), 'abc123');
  assert.equal(E.parseVideoUrl('https://evil.example.com/v/abc123', origins), null);
  assert.equal(E.parseVideoUrl('https://videos.example.com/u/someone', origins), null);
  assert.equal(E.parseVideoUrl('https://videos.example.com/v/a/b', origins), null);
  assert.equal(E.parseVideoUrl('javascript:alert(1)', origins), null);
  assert.equal(E.parseVideoUrl('not a url', origins), null);
});

test('tracking params are stripped from stored product links', () => {
  assert.equal(U.stripTrackingParams('https://s.example/p/1?utm_source=a&utm_medium=b&pv_click=zz&color=red#frag'), 'https://s.example/p/1?color=red');
});

test('product URL variants cover trailing-slash spellings and ignore tracking', () => {
  const v = U.productUrlVariants('https://s.example/listings/9?utm_source=x');
  assert.deepEqual(new Set(v), new Set(['https://s.example/listings/9', 'https://s.example/listings/9/']));
  assert.deepEqual(U.productUrlVariants('https://s.example/p?id=3'), ['https://s.example/p?id=3']);
});
