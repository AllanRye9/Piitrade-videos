import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDockedProduct, productPosition } from '../src/productLogic.ts';

test('product tags with missing coordinates are docked instead of positioned', () => {
  const frame = { left: 10, top: 20, width: 100, height: 200 };
  assert.equal(isDockedProduct({ x: null, y: null }), true);
  assert.equal(productPosition({ x: null, y: null }, frame), null);
});

test('hotspot coordinates are relative to the rendered video frame', () => {
  assert.deepEqual(productPosition({ x: 0.25, y: 0.75 }, { left: 10, top: 20, width: 100, height: 200 }), {
    left: 35,
    top: 170,
  });
});
