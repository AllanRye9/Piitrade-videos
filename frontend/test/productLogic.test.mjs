import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeProducts, frameRect } from '../src/productLogic.ts';

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
