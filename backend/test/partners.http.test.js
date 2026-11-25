const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const db = { sites: [], apps: [], seq: 0 };
const match = (row, where = {}) => Object.entries(where).every(([k, v]) => (v === null ? row[k] == null : row[k] === v));
const fake = {
  auditLog: { create: async () => ({}) },
  site: {
    findMany: async () => db.sites.map((s) => ({ ...s })),
    findUnique: async ({ where }) => db.sites.find((s) => s.slug === where.slug || s.id === where.id) || null,
    create: async ({ data }) => { const s = { id: `s${++db.seq}`, createdAt: new Date(), ...data }; db.sites.push(s); return s; },
  },
  partnerApplication: {
    findFirst: async ({ where }) => db.apps.find((a) => match(a, where)) || null,
    findUnique: async ({ where, include }) => {
      const a = db.apps.find((x) => x.id === where.id);
      return a ? { ...a, ...(include?.site ? { site: db.sites.find((s) => s.id === a.siteId) || null } : {}) } : null;
    },
    findMany: async ({ where }) => db.apps.filter((a) => match(a, where)),
    create: async ({ data }) => { const a = { id: `a${++db.seq}`, createdAt: new Date(), status: 'pending', reviewNote: '', siteId: null, credentialsClaimedAt: null, reviewedAt: null, ...data }; db.apps.push(a); return a; },
    update: async ({ where, data }) => { const a = db.apps.find((x) => x.id === where.id); Object.assign(a, data); return a; },
    updateMany: async ({ where, data }) => { const rows = db.apps.filter((a) => match(a, where)); rows.forEach((a) => Object.assign(a, data)); return { count: rows.length }; },
  },
};
const resolve = (p) => require.resolve(p);
require.cache[resolve('../dist/db')] = { id: resolve('../dist/db'), filename: resolve('../dist/db'), loaded: true, exports: { prisma: fake } };
// The admin guard has its own tests (permissions.test.js); here every request is an admin who may do everything.
const guardPath = resolve('../dist/middleware/requireAdmin');
require.cache[guardPath] = { id: guardPath, filename: guardPath, loaded: true, exports: { requireAdmin: (_q, _s, n) => n(), requirePermission: () => (_q, _s, n) => n() } };

// Rate limits have their own behaviour; they would otherwise cap this suite at 6 applications per hour.
const limitPath = resolve('../dist/middleware/rateLimit');
const pass = (_q, _s, n) => n();
require.cache[limitPath] = { id: limitPath, filename: limitPath, loaded: true, exports: { partnerApplyLimiter: pass, partnerStatusLimiter: pass } };

require('express-async-errors');
const express = require('express');
const partners = require('../dist/routes/partners').default;
const adminApps = require('../dist/routes/admin/partnerApplications').default;

// The partner's listing API lives on a public-looking host; answer it without touching the network.
let listingResponse;
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.good.example.com') || String(url).startsWith('https://api.bad.example.com')) return listingResponse(String(url));
  return realFetch(url, opts);
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const goodListings = () => json({ listings: [{ id: '1', title: 'Sofa', price: 10, images: ['https://cdn.example.com/1.jpg'] }] });

let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/partners', partners);
  app.use('/api/admin/partner-applications', adminApps);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code, ...(err.details || {}) }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); global.fetch = realFetch; });
beforeEach(() => { db.sites = []; db.apps = []; listingResponse = goodListings; });

const form = (over = {}) => ({ name: 'Acme Shop', baseUrl: 'https://www.good.example.com/', apiBase: 'https://api.good.example.com/', contactEmail: 'Owner@Good.example.com', country: 'ug', currency: 'ugx', ...over });
const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
const status = (id, token) => fetch(`${base}/api/partners/applications/${id}`, { headers: token ? { 'x-application-token': token } : {} });

test('a shop whose listing API passes the spec is queued, and the token is shown once (only its hash is stored)', async () => {
  const r = await post('/api/partners/apply', form());
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.application.status, 'pending');
  assert.ok(body.statusToken && body.statusToken.length >= 20);
  const row = db.apps[0];
  assert.equal(row.host, 'good.example.com'); // www and trailing slash normalised
  assert.equal(row.apiBase, 'https://api.good.example.com');
  assert.equal(row.country, 'UG');
  assert.equal(row.contactEmail, 'owner@good.example.com');
  assert.notEqual(row.tokenHash, body.statusToken);
  assert.equal(JSON.stringify(row).includes(body.statusToken), false);
});

test('an API that fails the open spec is not queued and the applicant gets the exact problems', async () => {
  listingResponse = () => json({ listings: [{ id: '1', price: 10 }] }); // no title
  const r = await post('/api/partners/apply', form());
  assert.equal(r.status, 422);
  const body = await r.json();
  assert.equal(body.code, 'API_CHECK_FAILED');
  assert.ok(body.check.issues.some((i) => /title/.test(i.message)));
  assert.equal(db.apps.length, 0);
});

test('an unreachable or erroring API is refused too', async () => {
  listingResponse = () => json({ error: 'nope' }, 500);
  assert.equal((await post('/api/partners/apply', form())).status, 422);
  listingResponse = () => { throw new Error('ECONNREFUSED'); };
  assert.equal((await post('/api/partners/apply', form())).status, 422);
  assert.equal(db.apps.length, 0);
});

test('the form is validated: API base is required, private hosts are refused (no probing the internal network)', async () => {
  for (const bad of [
    { apiBase: '' }, { name: '' }, { contactEmail: 'nope' }, { country: 'UGA' }, { currency: 'U' },
    { apiBase: 'http://localhost:4000' }, { apiBase: 'http://169.254.169.254' }, { apiBase: 'http://10.0.0.5' }, { baseUrl: 'ftp://x.example.com' },
  ]) {
    const r = await post('/api/partners/apply', form(bad));
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal(db.apps.length, 0);
});

test('duplicates: an existing partner or a pending application for the same website is refused', async () => {
  db.sites.push({ id: 's0', baseUrl: 'https://good.example.com', slug: 'good' });
  const a = await post('/api/partners/apply', form());
  assert.equal(a.status, 409);
  assert.equal((await a.json()).code, 'ALREADY_PARTNER');
  db.sites = [];
  assert.equal((await post('/api/partners/apply', form())).status, 201);
  const b = await post('/api/partners/apply', form({ name: 'Acme again' }));
  assert.equal(b.status, 409);
  assert.equal((await b.json()).code, 'ALREADY_PENDING');
});

test('status needs the right token; a wrong id and a wrong token look the same', async () => {
  const { application, statusToken } = await (await post('/api/partners/apply', form())).json();
  assert.equal((await status(application.id)).status, 404);
  assert.equal((await status(application.id, 'wrong')).status, 404);
  assert.equal((await status('nope', statusToken)).status, 404);
  const ok = await status(application.id, statusToken);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.application.status, 'pending');
  assert.equal(body.credentials, undefined);
});

test('approval registers the shop; the postback secret is collectable exactly once', async () => {
  const { application, statusToken } = await (await post('/api/partners/apply', form())).json();
  const list = await (await fetch(`${base}/api/admin/partner-applications?status=pending`)).json();
  assert.equal(list.applications.length, 1);
  assert.equal(list.applications[0].verification.ok, true);

  const approved = await post(`/api/admin/partner-applications/${application.id}/approve`, { commissionPct: 7.5 });
  assert.equal(approved.status, 200);
  assert.equal(db.sites.length, 1);
  const site = db.sites[0];
  assert.deepEqual([site.slug, site.baseUrl, site.apiBase, site.commissionPct, site.active, site.country, site.currency], ['acme-shop', 'https://www.good.example.com', 'https://api.good.example.com', 7.5, true, 'UG', 'UGX']);
  assert.ok(site.postbackSecret.length >= 32);

  const first = await (await status(application.id, statusToken)).json();
  assert.equal(first.application.status, 'approved');
  assert.equal(first.partner.slug, 'acme-shop');
  assert.equal(first.credentials.postbackSecret, site.postbackSecret);
  const second = await (await status(application.id, statusToken)).json();
  assert.equal(second.credentials, undefined); // already collected
});

test('an application can be reviewed once; double approval or approve-after-reject is refused and creates no second shop', async () => {
  const { application } = await (await post('/api/partners/apply', form())).json();
  assert.equal((await post(`/api/admin/partner-applications/${application.id}/approve`)).status, 200);
  assert.equal((await post(`/api/admin/partner-applications/${application.id}/approve`)).status, 409);
  assert.equal((await post(`/api/admin/partner-applications/${application.id}/reject`)).status, 409);
  assert.equal(db.sites.length, 1);
});

test('rejection records the reason, the applicant sees it, and gets no credentials', async () => {
  const { application, statusToken } = await (await post('/api/partners/apply', form())).json();
  assert.equal((await post(`/api/admin/partner-applications/${application.id}/reject`, { reviewNote: 'Not a marketplace' })).status, 200);
  const s = await (await status(application.id, statusToken)).json();
  assert.deepEqual([s.application.status, s.application.reviewNote, s.credentials, db.sites.length], ['rejected', 'Not a marketplace', undefined, 0]);
  // …and the shop can apply again after a rejection.
  assert.equal((await post('/api/partners/apply', form())).status, 201);
});

test('commission outside 0–100 is refused and leaves the application pending', async () => {
  const { application } = await (await post('/api/partners/apply', form())).json();
  assert.equal((await post(`/api/admin/partner-applications/${application.id}/approve`, { commissionPct: 150 })).status, 400);
  assert.equal(db.apps[0].status, 'pending');
});

test('GET /spec describes what a shop must expose', async () => {
  const body = await (await fetch(`${base}/api/partners/spec`)).json();
  assert.ok(body.listingEndpoint.includes('/api/listings'));
  assert.ok(body.requiredFields.includes('listings[].title'));
});
