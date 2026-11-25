import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_API_BASE, DEFAULT_WEB_URL, PRODUCTION_HOST, WEB_HOST, buildApiUrl, resolveApiBase, resolveMediaUrl, resolveWebUrl } from '../src/lib/apiBase.ts';

test('the app talks to v.piitrade.com; the website is videos.piitrade.com', () => {
  assert.equal(PRODUCTION_HOST, 'v.piitrade.com');
  assert.equal(DEFAULT_API_BASE, 'https://v.piitrade.com');
  assert.equal(WEB_HOST, 'videos.piitrade.com');
  assert.equal(DEFAULT_WEB_URL, 'https://videos.piitrade.com');
});

test('falls back to production API base when unset, blank, quoted empty, unparseable or non-http', () => {
  assert.equal(resolveApiBase(undefined), DEFAULT_API_BASE);
  assert.equal(resolveApiBase(''), DEFAULT_API_BASE);
  assert.equal(resolveApiBase('   '), DEFAULT_API_BASE);
  assert.equal(resolveApiBase('""'), DEFAULT_API_BASE);
  assert.equal(resolveApiBase('ftp://v.piitrade.com'), DEFAULT_API_BASE);
  assert.equal(resolveApiBase('not a url'), DEFAULT_API_BASE);
});

test('strips trailing slashes and /api suffixes so /api/* paths never double up', () => {
  assert.equal(resolveApiBase('https://v.piitrade.com/'), 'https://v.piitrade.com');
  assert.equal(resolveApiBase('https://v.piitrade.com/api'), 'https://v.piitrade.com');
  assert.equal(resolveApiBase('https://v.piitrade.com/api/'), 'https://v.piitrade.com');
  assert.equal(resolveApiBase('https://v.piitrade.com/api/videos'), 'https://v.piitrade.com');
  assert.equal(resolveApiBase('http://localhost:4000/api/'), 'http://localhost:4000');
});

test('a stale yotweek address (the cause of HTTP 404 everywhere) resolves to the production host', () => {
  for (const stale of ['https://yotweek.com', 'https://www.yotweek.com/', 'https://api.yotweek.com', 'https://api.yotweek.com/', 'https://api.yotweek.com/api', 'api.yotweek.com']) {
    assert.equal(resolveApiBase(stale), DEFAULT_API_BASE, stale);
  }
});

test('a scheme-less production host gets https, and plain http to it is upgraded (release builds block cleartext)', () => {
  assert.equal(resolveApiBase('v.piitrade.com'), 'https://v.piitrade.com');
  assert.equal(resolveApiBase('http://v.piitrade.com'), 'https://v.piitrade.com');
});

test('a stale build value naming the website host still gives the app its own API host', () => {
  assert.equal(resolveApiBase('https://videos.piitrade.com'), 'https://v.piitrade.com');
  assert.equal(resolveApiBase('https://videos.piitrade.com/api'), 'https://v.piitrade.com');
});

test('preserves custom staging origins, local dev servers and non-api base paths', () => {
  assert.equal(resolveApiBase('https://example.com'), 'https://example.com');
  assert.equal(resolveApiBase('https://staging.example.com/backend/'), 'https://staging.example.com/backend');
  assert.equal(resolveApiBase('http://10.0.2.2:4000'), 'http://10.0.2.2:4000');
});

test('web URL defaults to the website host, follows a custom backend, and ignores a stale yotweek value', () => {
  assert.equal(resolveWebUrl(undefined, DEFAULT_API_BASE), 'https://videos.piitrade.com');
  assert.equal(resolveWebUrl('', DEFAULT_API_BASE), 'https://videos.piitrade.com');
  assert.equal(resolveWebUrl('https://yotweek.com', DEFAULT_API_BASE), 'https://videos.piitrade.com');
  assert.equal(resolveWebUrl('https://piitrade.com/', DEFAULT_API_BASE), 'https://piitrade.com');
  assert.equal(resolveWebUrl(undefined, 'https://staging.example.com'), 'https://staging.example.com');
  assert.equal(resolveWebUrl(undefined, 'http://10.0.2.2:4000'), 'http://10.0.2.2:4000');
});

test('buildApiUrl always puts exactly one slash between base and path', () => {
  assert.equal(buildApiUrl('https://v.piitrade.com', '/api/videos'), 'https://v.piitrade.com/api/videos');
  assert.equal(buildApiUrl('https://v.piitrade.com', 'api/videos'), 'https://v.piitrade.com/api/videos');
});

test('media URLs: local-disk paths resolve against the base, R2 URLs pass through', () => {
  const base = DEFAULT_API_BASE;
  assert.equal(resolveMediaUrl('/uploads/videos/a.mp4', base), 'https://v.piitrade.com/uploads/videos/a.mp4');
  assert.equal(resolveMediaUrl('uploads/posters/a.jpg', base), 'https://v.piitrade.com/uploads/posters/a.jpg');
  assert.equal(resolveMediaUrl('https://media.example.com/videos/a.mp4', base), 'https://media.example.com/videos/a.mp4');
  assert.equal(resolveMediaUrl('//cdn.example.com/a.mp4', base), 'https://cdn.example.com/a.mp4');
});

test('media URLs: http on our own host is upgraded to https, other hosts are left alone', () => {
  const base = DEFAULT_API_BASE;
  assert.equal(resolveMediaUrl('http://v.piitrade.com/uploads/p.jpg', base), 'https://v.piitrade.com/uploads/p.jpg');
  assert.equal(resolveMediaUrl('http://videos.piitrade.com/uploads/p.jpg', base), 'https://videos.piitrade.com/uploads/p.jpg');
  assert.equal(resolveMediaUrl('http://other.example.com/p.jpg', base), 'http://other.example.com/p.jpg');
  assert.equal(resolveMediaUrl('http://10.0.2.2:4000/uploads/p.jpg', 'http://10.0.2.2:4000'), 'http://10.0.2.2:4000/uploads/p.jpg');
});

test('media URLs: empty values give undefined, just-picked local files pass through', () => {
  assert.equal(resolveMediaUrl(undefined, DEFAULT_API_BASE), undefined);
  assert.equal(resolveMediaUrl(null, DEFAULT_API_BASE), undefined);
  assert.equal(resolveMediaUrl('   ', DEFAULT_API_BASE), undefined);
  assert.equal(resolveMediaUrl('file:///data/user/0/a.jpg', DEFAULT_API_BASE), 'file:///data/user/0/a.jpg');
  assert.equal(resolveMediaUrl('content://media/1', DEFAULT_API_BASE), 'content://media/1');
});
