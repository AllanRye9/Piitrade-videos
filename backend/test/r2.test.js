const { test } = require('node:test');
const assert = require('node:assert/strict');
const { publicUrlForKey, keyFromPublicUrl, objectKey, contentTypeFor } = require('../dist/lib/r2');

test('builds public URLs and round-trips them back to keys', () => {
  const base = 'https://media.example.com/';
  const key = objectKey('videos', 'a b.mp4');
  const url = publicUrlForKey(base, key);
  assert.equal(url, 'https://media.example.com/videos/a%20b.mp4');
  assert.equal(keyFromPublicUrl('https://media.example.com', url), key);
});

test('ignores URLs that are not ours (legacy ImageKit, local filenames)', () => {
  assert.equal(keyFromPublicUrl('https://media.example.com', 'https://ik.imagekit.io/x/videos/a.mp4'), null);
  assert.equal(keyFromPublicUrl('https://media.example.com', 'abc.mp4'), null);
  assert.equal(keyFromPublicUrl('https://media.example.com', 'https://media.example.com.evil.com/videos/a.mp4'), null);
});

test('content types', () => {
  assert.equal(contentTypeFor('x.mp4'), 'video/mp4');
  assert.equal(contentTypeFor('x.JPG'), 'image/jpeg');
});
