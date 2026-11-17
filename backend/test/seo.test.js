const { test } = require('node:test');
const assert = require('node:assert/strict');
const seo = require('../dist/lib/seo');

const ORIGIN = 'https://videos.example.com';
const video = (over = {}) => ({
  id: 'abc123', title: 'Red <sneakers> & "bargains"', description: 'Size 42, barely worn #shoes #kampala', contentUrl: `${ORIGIN}/uploads/videos/a.mp4`,
  thumbnailUrl: `${ORIGIN}/uploads/posters/a.jpg`, duration: 65, createdAt: new Date('2026-11-01T10:00:00Z'), hashtags: ['shoes', 'kampala'],
  likes: 3, views: 10, comments: 1, creator: { name: 'Rye', url: `${ORIGIN}/u/rye` }, ...over,
});

test('isoDuration formats seconds as ISO 8601', () => {
  assert.equal(seo.isoDuration(65), 'PT1M5S');
  assert.equal(seo.isoDuration(3600), 'PT1H');
  assert.equal(seo.isoDuration(59.6), 'PT1M');
  assert.equal(seo.isoDuration(0), undefined);
  assert.equal(seo.isoDuration(null), undefined);
});

test('truncate cuts at a word boundary and collapses whitespace', () => {
  assert.equal(seo.truncate('  a   b  ', 50), 'a b');
  const out = seo.truncate('word '.repeat(60), 40);
  assert.ok(out.length <= 40 && out.endsWith('…'));
});

test('resolveOrigin prefers SITE_URL, else the request host', () => {
  assert.equal(seo.resolveOrigin('https://x.com/', 'http', 'y.com'), 'https://x.com');
  assert.equal(seo.resolveOrigin(undefined, 'https, http', 'y.com'), 'https://y.com');
  assert.equal(seo.resolveOrigin(undefined, 'javascript', 'y.com'), 'https://y.com');
});

test('video meta + injection escapes user text and replaces the shell defaults', () => {
  const shell = '<html><head><title>Piitrade Videos</title><meta name="description" content="old" /><meta property="og:title" content="old" data-seo /></head><body><div id="root"></div></body></html>';
  const html = seo.injectHead(shell, seo.videoMeta(ORIGIN, video()));
  assert.equal((html.match(/<title/g) || []).length, 1);
  assert.ok(!html.includes('content="old"'));
  assert.ok(!html.includes('<sneakers>'), 'raw angle brackets must be escaped');
  assert.match(html, /&lt;sneakers&gt; &amp; &quot;bargains&quot;/);
  assert.match(html, /<link rel="canonical" href="https:\/\/videos\.example\.com\/v\/abc123" data-seo \/>/);
  assert.match(html, /og:video" content="https:\/\/videos\.example\.com\/uploads\/videos\/a\.mp4"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /<div id="root">/);
});

test('JSON-LD is valid JSON, cannot break out of its script tag, and has the VideoObject fields', () => {
  const html = seo.injectHead('<head></head>', seo.videoMeta(ORIGIN, video({ title: '</script><script>alert(1)</script>' })));
  const m = /<script type="application\/ld\+json" data-seo>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'one JSON-LD block');
  assert.ok(!m[1].includes('</script>') && !m[1].includes('<'));
  const data = JSON.parse(m[1]);
  assert.equal(data['@type'], 'VideoObject');
  assert.equal(data.duration, 'PT1M5S');
  assert.equal(data.uploadDate, '2026-11-01T10:00:00.000Z');
  assert.deepEqual(data.thumbnailUrl, [`${ORIGIN}/uploads/posters/a.jpg`]);
});

test('reported videos are noindex; missing posters downgrade the twitter card', () => {
  assert.match(seo.renderHeadTags(seo.videoMeta(ORIGIN, video(), { noindex: true })), /name="robots" content="noindex, follow"/);
  assert.match(seo.renderHeadTags(seo.videoMeta(ORIGIN, video({ thumbnailUrl: null }))), /name="twitter:card" content="summary"/);
});

test('sitemap is well-formed, escapes text, and skips video metadata it cannot fill', () => {
  const xml = seo.buildSitemap(ORIGIN, ['/', '/legal/terms'], [
    { ...video(), views: 10 },
    { ...video({ id: 'nopost', thumbnailUrl: null }), views: 0 },
    { ...video({ id: 'ctl', title: 'bad\u0001char & more' }), views: 1 },
  ]);
  assert.match(xml, /^<\?xml/);
  assert.ok(xml.includes('<loc>https://videos.example.com/legal/terms</loc>'));
  assert.ok(xml.includes('&lt;sneakers&gt; &amp; &quot;bargains&quot;'));
  assert.ok(!xml.includes('\u0001'));
  assert.equal((xml.match(/<video:video>/g) || []).length, 2);
  assert.ok(xml.includes('<loc>https://videos.example.com/v/nopost</loc>'));
});

test('robots.txt blocks admin/api and points at the sitemap', () => {
  const r = seo.buildRobots(ORIGIN);
  assert.match(r, /Disallow: \/const\//);
  assert.match(r, /Disallow: \/api\//);
  assert.match(r, /Sitemap: https:\/\/videos\.example\.com\/sitemap\.xml/);
});

test('static page meta covers home and legal pages only', () => {
  assert.equal(seo.staticPageMeta(ORIGIN, '/').canonical, `${ORIGIN}/`);
  assert.equal(seo.staticPageMeta(ORIGIN, '/legal/privacy').canonical, `${ORIGIN}/legal/privacy`);
  assert.equal(seo.staticPageMeta(ORIGIN, '/legal/nope'), null);
  assert.equal(seo.staticPageMeta(ORIGIN, '/profile'), null);
});
