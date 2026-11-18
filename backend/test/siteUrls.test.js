const { test } = require('node:test');
const assert = require('node:assert/strict');
const u = require('../dist/lib/siteUrls');

const site = (over = {}) => ({ id: 's1', name: 'Shop', slug: 'shop', siteUrl: 'https://shop.example.com', apiUrl: '', apiType: 'link-only', country: '', currency: '', listingPath: '/listings/{id}', searchPath: '/listings?q={q}', sellPath: '/sell', active: true, position: 0, ...over });

test('slugify', () => {
  assert.equal(u.slugify('My Shop!! Uganda'), 'my-shop-uganda');
  assert.equal(u.slugify('  Café  Ñandú '), 'cafe-nandu');
  assert.equal(u.slugify('!!!'), '');
});

test('normalizeBaseUrl accepts public http(s), strips path slash/query/hash, rejects the rest', () => {
  assert.equal(u.normalizeBaseUrl('https://shop.example.com/', 'x'), 'https://shop.example.com');
  assert.equal(u.normalizeBaseUrl('https://api.example.com/v1/?a=1#h', 'x'), 'https://api.example.com/v1');
  for (const bad of ['', 'shop.example.com', 'ftp://x.com', 'javascript:alert(1)', 'https://user:pw@x.com']) assert.throws(() => u.normalizeBaseUrl(bad, 'x'), u.SiteValidationError, bad);
});

test('private/loopback hosts are refused unless explicitly allowed (SSRF guard)', () => {
  for (const h of ['http://localhost:3000', 'http://127.0.0.1', 'http://10.1.2.3', 'http://192.168.0.5', 'http://172.20.1.1', 'http://169.254.169.254', 'http://[::1]', 'http://db.internal']) {
    assert.throws(() => u.normalizeBaseUrl(h, 'x'), u.SiteValidationError, h);
    assert.ok(u.normalizeBaseUrl(h, 'x', { allowPrivate: true }));
  }
  assert.ok(u.normalizeBaseUrl('http://172.32.0.1', 'x'), '172.32 is public');
});

test('path templates must be on-site paths with their placeholders', () => {
  assert.equal(u.normalizePathTemplate('', 'p', '/listings/{id}', ['{id}']), '/listings/{id}');
  assert.equal(u.normalizePathTemplate('/p/{id}', 'p', '/x', ['{id}']), '/p/{id}');
  assert.throws(() => u.normalizePathTemplate('https://evil.com/{id}', 'p', '/x', ['{id}']));
  assert.throws(() => u.normalizePathTemplate('//evil.com/{id}', 'p', '/x', ['{id}']));
  assert.throws(() => u.normalizePathTemplate('/p/nothing', 'p', '/x', ['{id}']));
});

test('listing / search / sell / home URLs fill templates, encode input and add attribution', () => {
  const s = site();
  assert.equal(u.listingUrlFor(s, 'a b/1'), 'https://shop.example.com/listings/a%20b%2F1?utm_source=piitrade_videos&utm_medium=video');
  assert.equal(u.searchUrlFor(s, 'red shoes & more'), 'https://shop.example.com/listings?q=red+shoes+%26+more&utm_source=piitrade_videos&utm_medium=video');
  assert.equal(u.searchUrlFor(s, '  '), 'https://shop.example.com/listings?utm_source=piitrade_videos&utm_medium=video');
  assert.equal(u.sellUrlFor(s), 'https://shop.example.com/sell?utm_source=piitrade_videos&utm_medium=video');
  assert.equal(u.sellUrlFor(site({ sellPath: '' })), null);
  assert.match(u.siteHomeUrl(s), /^https:\/\/shop\.example\.com\/\?utm_source=/);
  assert.equal(u.listingUrlFor(site({ siteUrl: 'https://x.com/store' }), '9'), 'https://x.com/store/listings/9?utm_source=piitrade_videos&utm_medium=video');
});

test('urlBelongsToSite / matchSiteByUrl: same host, www and subdomains only', () => {
  const a = site({ siteUrl: 'https://piitrade.com' });
  const b = site({ id: 's2', siteUrl: 'https://store.piitrade.com' });
  assert.ok(u.urlBelongsToSite('https://www.piitrade.com/listings/1', a));
  assert.ok(u.urlBelongsToSite('https://m.piitrade.com/x', a));
  assert.ok(!u.urlBelongsToSite('https://evilpiitrade.com/x', a));
  assert.ok(!u.urlBelongsToSite('https://piitrade.com.evil.com/x', a));
  assert.ok(!u.urlBelongsToSite('not a url', a));
  assert.equal(u.matchSiteByUrl('https://store.piitrade.com/p/1', [a, b]).id, 's2', 'most specific host wins');
  assert.equal(u.matchSiteByUrl('https://other.com', [a, b]), null);
});

test('normalizeProductUrl', () => {
  assert.equal(u.normalizeProductUrl(' https://shop.example.com/p/1#frag '), 'https://shop.example.com/p/1');
  for (const bad of ['', 'nope', 'javascript:alert(1)', 'https://u:p@x.com/', 'https://x.com/' + 'a'.repeat(600)]) assert.throws(() => u.normalizeProductUrl(bad), u.SiteValidationError);
});

test('productLinkForDisplay keeps existing utm params', () => {
  assert.match(u.productLinkForDisplay('https://x.com/p'), /utm_source=piitrade_videos/);
  assert.equal(new URL(u.productLinkForDisplay('https://x.com/p?utm_source=mine')).searchParams.get('utm_source'), 'mine');
});
