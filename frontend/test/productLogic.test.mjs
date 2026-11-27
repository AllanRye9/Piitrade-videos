import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeProducts, frameRect } from '../src/features/products/productLogic.ts';

test('activeProducts includes start and excludes end', () => {
  const products = [
    { id: 'a', startMs: 0, endMs: 2000 },
    { id: 'b', startMs: 1000, endMs: null },
  ];
  assert.deepEqual(activeProducts(products, 1000).map((product) => product.id), ['a', 'b']);
  assert.deepEqual(activeProducts(products, 2000).map((product) => product.id), ['b']);
});

test('frameRect maps cover-fit coordinates into the centered cropped frame', () => {
  assert.deepEqual(frameRect(400, 800, 1920, 1080), {
    left: -511.1111111111111,
    top: 0,
    width: 1422.2222222222222,
    height: 800,
  });
});

test('frameRect with contain keeps the whole picture inside the card, cover stays the default', async () => {
  const { frameRect, frameFit } = await import('../src/features/products/productLogic.ts');
  assert.deepEqual(frameRect(390, 844, 1080, 1920), frameRect(390, 844, 1080, 1920, 'cover'));
  const c = frameRect(390, 844, 1920, 1080, 'contain');
  assert.ok(c.width <= 390 + 1e-6 && c.height <= 844 + 1e-6);
  assert.equal(frameFit(390, 844, 1920, 1080), 'contain');
});
