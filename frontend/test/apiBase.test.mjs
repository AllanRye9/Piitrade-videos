import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRODUCTION_API_BASE, resolveApiBase } from '../src/lib/apiBase.ts';

test('production domain ignores stale build-time API overrides', () => {
  assert.equal(resolveApiBase('https://stale.example.com/', 'yotweek.com'), PRODUCTION_API_BASE);
  assert.equal(resolveApiBase('', 'www.yotweek.com'), PRODUCTION_API_BASE);
  assert.equal(resolveApiBase('https://api.yotweek.com', 'videos.piitrade.com'), 'https://videos.piitrade.com');
  assert.equal(PRODUCTION_API_BASE, 'https://videos.piitrade.com');
});

test('non-production hosts use a normalized configured API base', () => {
  assert.equal(resolveApiBase(' https://api.example.com/// ', 'localhost'), 'https://api.example.com');
  assert.equal(resolveApiBase(undefined, 'localhost'), '');
});
