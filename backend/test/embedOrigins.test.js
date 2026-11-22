const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeOriginsInput, resolveFrameAncestors } = require('../dist/lib/embedOrigins.js');

test('normalizes exact and wildcard origins and rejects paths', () => {
  assert.equal(
    normalizeOriginsInput('https://BLOG.example.com/\nhttps://*.example.org'),
    'https://blog.example.com\nhttps://*.example.org'
  );
  assert.throws(() => normalizeOriginsInput('https://blog.example.com/path'), { status: 400 });
});

test('an unrestricted deployment remains embeddable from any site', () => {
  assert.equal(resolveFrameAncestors('*', []), '*');
  assert.equal(resolveFrameAncestors(undefined, [{ baseUrl: 'https://shop.example', embedOrigins: '' }]), '*');
});

test('shop allow-lists intersect and always retain the app and each shop origin', () => {
  assert.equal(
    resolveFrameAncestors(undefined, [
      { baseUrl: 'https://shop.example', embedOrigins: 'https://blog.example https://*.partner.example' },
      { baseUrl: 'https://shop.example', embedOrigins: 'https://blog.example https://*.other.example' },
    ]),
    "'self' https://shop.example https://blog.example"
  );
});

test('global rules narrow shop wildcards and invalid global input fails closed to self', () => {
  assert.equal(
    resolveFrameAncestors('https://store.partner.example', [
      { baseUrl: 'https://shop.example', embedOrigins: 'https://*.partner.example' },
    ]),
    'https://store.partner.example'
  );
  assert.equal(resolveFrameAncestors('not-an-origin', []), "'self'");
});
