// The web app and the mobile app each carry their own copy of the logic that places product tags on a video.
// They cannot share a module (different bundlers), so these tests feed both the same inputs and require the
// same answers — the guard that keeps the two UIs behaving consistently.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as web from '../frontend/src/productLogic.ts';
import * as mobile from '../mobile/src/lib/productLogic.ts';

const products = [
  { id: 'a', startMs: 0, endMs: 2000, x: 0.1, y: 0.2 },
  { id: 'b', startMs: 1000, endMs: null, x: null, y: null },
  { id: 'c', startMs: 3000, endMs: 4000, x: 0.5, y: 0.5 },
  { id: 'd', startMs: 2000, endMs: 2000, x: 0.9, y: 0.9 }, // empty window
];

test('both apps show the same tags at every moment of the video (start inclusive, end exclusive)', () => {
  for (let ms = -100; ms <= 5000; ms += 50) {
    const w = web.activeProducts(products, ms).map((p) => p.id);
    const m = mobile.activeProducts(products, ms).map((p) => p.id);
    assert.deepEqual(m, w, `tag sets differ at ${ms} ms`);
  }
  for (const ms of [0, 1000, 2000, 3000, 4000]) {
    assert.deepEqual(mobile.activeProducts(products, ms).map((p) => p.id), web.activeProducts(products, ms).map((p) => p.id), `boundary ${ms}`);
  }
  assert.deepEqual(mobile.activeProducts([], 10), web.activeProducts([], 10));
});

test('both apps center-crop videos to fill the card identically', () => {
  const cards = [[390, 844], [360, 640], [1080, 1920], [300, 300]];
  const videos = [[1080, 1920], [1920, 1080], [1000, 1000], [640, 360], [2160, 3840]];
  for (const [cw, ch] of cards) {
    for (const [vw, vh] of videos) {
      assert.deepEqual(mobile.frameRect(cw, ch, { w: vw, h: vh }, 'cover'), web.frameRect(cw, ch, vw, vh), `card ${cw}x${ch}, video ${vw}x${vh}`);
    }
    // unknown video size: the whole card on both
    assert.deepEqual(mobile.frameRect(cw, ch, null, 'cover'), web.frameRect(cw, ch, 0, 0));
  }
});

test('cover crops overflow symmetrically while preserving source aspect ratio', () => {
  for (const impl of [(cw, ch, vw, vh) => web.frameRect(cw, ch, vw, vh), (cw, ch, vw, vh) => mobile.frameRect(cw, ch, { w: vw, h: vh }, 'cover')]) {
    const f = impl(390, 844, 1920, 1080);
    assert.ok(f.left <= 0 && f.top <= 0);
    assert.ok(f.left + f.width >= 390 - 1e-6 && f.top + f.height >= 844 - 1e-6);
    assert.ok(Math.abs(f.left + f.width / 2 - 195) < 1e-6);
    assert.ok(Math.abs(f.top + f.height / 2 - 422) < 1e-6);
    assert.ok(Math.abs(f.width / f.height - 1920 / 1080) < 1e-9);
  }
});

test('hotspot positions land inside the picture on the web, and docked tags have no position', () => {
  const frame = web.frameRect(390, 844, 1920, 1080);
  for (const p of products) {
    const pos = web.productPosition(p, frame);
    if (web.isDockedProduct(p)) {
      assert.equal(pos, null);
    } else {
      assert.ok(pos.left >= frame.left && pos.left <= frame.left + frame.width);
      assert.ok(pos.top >= frame.top && pos.top <= frame.top + frame.height);
    }
  }
});
