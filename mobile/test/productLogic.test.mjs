import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeProducts, frameRect, parseVideoLink, embedSnippet, clock } from '../src/lib/productLogic.ts';

test('activeProducts windows', () => {
  const ps = [{ id: 'a', startMs: 0, endMs: 2000 }, { id: 'b', startMs: 1000, endMs: null }, { id: 'c', startMs: 3000, endMs: 4000 }];
  assert.deepEqual(activeProducts(ps, 500).map((p) => p.id), ['a']);
  assert.deepEqual(activeProducts(ps, 1500).map((p) => p.id), ['a', 'b']);
  assert.deepEqual(activeProducts(ps, 2000).map((p) => p.id), ['b']);
  assert.deepEqual(activeProducts(ps, 99999).map((p) => p.id), ['b']);
  assert.deepEqual(activeProducts([], 10), []);
});
test('frameRect: cover = whole card, contain = centred letterbox', () => {
  assert.deepEqual(frameRect(400, 800, { w: 1080, h: 1920 }, 'cover'), { left: 0, top: 0, width: 400, height: 800 });
  const r = frameRect(400, 800, { w: 1920, h: 1080 }, 'contain'); // landscape in a tall card
  assert.equal(r.width, 400); assert.equal(Math.round(r.height), 225);
  assert.equal(r.left, 0); assert.ok(Math.abs(r.top - (800 - r.height) / 2) < 1e-9);
  assert.deepEqual(frameRect(400, 800, null, 'contain'), { left: 0, top: 0, width: 400, height: 800 });
});
test('parseVideoLink accepts app + own-host links, rejects others', () => {
  const web = 'https://videos.example.com';
  assert.equal(parseVideoLink('piitrade://v/abc123', web), 'abc123');
  assert.equal(parseVideoLink('https://videos.example.com/v/abc123', web), 'abc123');
  assert.equal(parseVideoLink('https://videos.example.com/embed/abc123/', web), 'abc123');
  assert.equal(parseVideoLink('https://evil.com/v/abc123', web), null);
  assert.equal(parseVideoLink('piitrade://u/amina', web), null);
  assert.equal(parseVideoLink('https://videos.example.com/u/amina', web), null);
  assert.equal(parseVideoLink(null, web), null);
  assert.equal(parseVideoLink('garbage', web), null);
});
test('embedSnippet + clock', () => {
  assert.ok(embedSnippet('a b', 'https://x.com').includes('src="https://x.com/embed/a%20b"'));
  assert.equal(clock(7000), '0:07'); assert.equal(clock(65400), '1:05'); assert.equal(clock(-5), '0:00');
});
