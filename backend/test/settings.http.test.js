const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const db = { setting: null };
const fake = {
  auditLog: { create: async () => ({}) },
  appSetting: {
    findUnique: async () => db.setting,
    upsert: async ({ create, update }) => { db.setting = db.setting ? { ...db.setting, ...update } : { ...create, updatedAt: new Date() }; return db.setting; },
  },
};
const resolve = (p) => require.resolve(p);
const mock = (p, exports) => { const f = resolve(p); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
mock('../dist/db', { prisma: fake });
mock('../dist/middleware/requireAdmin', { requireAdmin: (_q, _s, n) => n(), requirePermission: () => (_q, _s, n) => n(), requirePrimary: (_q, _s, n) => n() });

require('express-async-errors');
const express = require('express');
const settings = require('../dist/lib/core/settings');
const { enforceSiteSettings } = require('../dist/middleware/siteSettings');
const configRouter = require('../dist/routes/config').default;
const adminSettings = require('../dist/routes/admin/settings').default;

let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', (req, _res, next) => { req.admin = { email: 'root@x.co' }; next(); });
  app.use('/api', enforceSiteSettings);
  app.use('/api/config', configRouter);
  app.use('/api/admin/settings', adminSettings);
  for (const p of ['/api/account/signup', '/api/videos', '/api/videos/abc/comments', '/api/videos/abc/like', '/api/partners/apply', '/api/attribution/conversion', '/api/events'])
    app.post(p, (_req, res) => res.json({ ok: true }));
  app.get('/api/videos', (_req, res) => res.json({ ok: true }));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => { db.setting = null; settings.clearSettingsCache(); });

const put = (body) => fetch(`${base}/api/admin/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const post = (p) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });

test('defaults: watch first, prompt after 20s of watching, everything open', async () => {
  const c = await (await fetch(`${base}/api/config`)).json();
  assert.deepEqual([c.guestPrompt.enabled, c.guestPrompt.firstAfterSeconds, c.maintenance.enabled, c.features.signups, c.announcement.enabled], [true, 20, false, true, false]);
  assert.ok(c.serverTime);
});

test('a partial patch changes only what it names and is served by /api/config', async () => {
  const r = await put({ guestPrompt: { firstAfterSeconds: 45 } });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).changed, ['guestPrompt']);
  settings.clearSettingsCache();
  const c = await (await fetch(`${base}/api/config`)).json();
  assert.equal(c.guestPrompt.firstAfterSeconds, 45);
  assert.equal(c.guestPrompt.baseGapSeconds, 60); // untouched
});

test('bad values are rejected naming the field, and nothing is saved', async () => {
  for (const [patch, field] of [
    [{ guestPrompt: { firstAfterSeconds: 0 } }, 'firstAfterSeconds'],
    [{ guestPrompt: { backoff: 9 } }, 'backoff'],
    [{ guestPrompt: { enabled: 'yes' } }, 'enabled'],
    [{ features: { uploads: 1 } }, 'uploads'],
    [{ announcement: { enabled: true, text: '' } }, 'announcement.text'],
    [{ announcement: { level: 'loud' } }, 'level'],
    [{ announcement: { link: 'javascript:alert(1)' } }, 'link'],
    [{ app: { minVersion: 'abc' } }, 'minVersion'],
    [{ app: { minVersion: '2.0.0', latestVersion: '1.0.0' } }, 'minVersion'],
  ]) {
    const r = await put(patch);
    assert.equal(r.status, 400, JSON.stringify(patch));
    assert.match((await r.json()).error, new RegExp(field));
  }
  assert.equal(db.setting, null);
});

test('maintenance pauses writes but never reads, admin, conversion postbacks or analytics', async () => {
  await put({ maintenance: { enabled: true, message: 'Back at 6' } });
  settings.clearSettingsCache();
  const w = await post('/api/videos/abc/like');
  assert.equal(w.status, 503);
  assert.deepEqual(await w.json(), { error: 'Back at 6', code: 'MAINTENANCE' });
  assert.equal((await fetch(`${base}/api/videos`)).status, 200);
  assert.equal((await post('/api/attribution/conversion')).status, 200);
  assert.equal((await post('/api/events')).status, 200);
  assert.equal((await put({ maintenance: { enabled: false } })).status, 200); // the admin can always switch it off
  settings.clearSettingsCache();
  assert.equal((await post('/api/videos/abc/like')).status, 200);
});

test('feature switches close exactly their own route', async () => {
  await put({ features: { signups: false, uploads: false, comments: false, partnerApplications: false } });
  settings.clearSettingsCache();
  const closed = { '/api/account/signup': 'SIGNUPS_CLOSED', '/api/videos': 'UPLOADS_CLOSED', '/api/videos/abc/comments': 'COMMENTS_CLOSED', '/api/partners/apply': 'PARTNER_APPLICATIONS_CLOSED' };
  for (const [p, code] of Object.entries(closed)) {
    const r = await post(p);
    assert.equal(r.status, 403, p);
    assert.equal((await r.json()).code, code);
  }
  assert.equal((await post('/api/videos/abc/like')).status, 200); // likes are not a switch
});

test('an announcement gets a new version whenever its content changes, so dismissed banners return', async () => {
  const a = (await (await put({ announcement: { enabled: true, text: 'Hello', level: 'success' } })).json()).settings.announcement;
  assert.equal(a.text, 'Hello');
  await new Promise((r) => setTimeout(r, 5));
  const same = (await (await put({ announcement: { text: 'Hello' } })).json()).settings.announcement;
  assert.equal(same.version, a.version);
  await new Promise((r) => setTimeout(r, 5));
  const changed = (await (await put({ announcement: { text: 'Hello again' } })).json()).settings.announcement;
  assert.notEqual(changed.version, a.version);
});

test('compareVersions orders numerically, not as text', () => {
  const { compareVersions } = settings;
  assert.equal(compareVersions('1.10.0', '1.9.2'), 1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
});

test('a broken stored value falls back to defaults instead of taking the site down', async () => {
  db.setting = { key: 'site', value: '{"guestPrompt":{"firstAfterSeconds":-5}}', updatedAt: new Date(), updatedBy: '' };
  const c = await (await fetch(`${base}/api/config`)).json();
  assert.equal(c.guestPrompt.firstAfterSeconds, 20);
});
