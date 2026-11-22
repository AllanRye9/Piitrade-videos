const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHash } = require('node:crypto');

const sha = (t) => createHash('sha256').update(t).digest('hex');
const db = { tokens: [], passwords: {}, emailFails: true };
const fake = {
  user: { findUnique: async ({ where }) => (where.email === 'real@x.com' ? { id: 'u1', email: 'real@x.com', passwordHash: 'old' } : null), update: async ({ where, data }) => { db.passwords[where.id] = data.passwordHash; } },
  sessionProfile: { findUnique: async () => null },
  passwordResetToken: {
    create: async ({ data }) => { db.tokens.push({ id: `t${db.tokens.length + 1}`, usedAt: null, ...data }); },
    findUnique: async ({ where }) => db.tokens.find((t) => t.tokenHash === where.tokenHash) || null,
    updateMany: async ({ where, data }) => {
      const hit = db.tokens.filter((t) => (where.id === undefined || t.id === where.id) && (where.userId === undefined || t.userId === where.userId) && (where.usedAt !== null || t.usedAt === null));
      hit.forEach((t) => Object.assign(t, data));
      return { count: hit.length };
    },
  },
  $transaction: async (fn) => fn(fake),
};
const dbPath = require.resolve('../dist/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: fake } };
const emailPath = require.resolve('../dist/lib/email');
require.cache[emailPath] = { id: emailPath, filename: emailPath, loaded: true, exports: { sendEmail: async () => { if (db.emailFails) throw new Error('SMTP down'); } } };

require('express-async-errors');
const express = require('express');
const account = require('../dist/routes/account');

let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/account', account.default);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => { db.tokens = []; db.passwords = {}; db.emailFails = true; });

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const addToken = (raw, over = {}) => db.tokens.push({ id: `t${db.tokens.length + 1}`, userId: 'u1', tokenHash: sha(raw), usedAt: null, expiresAt: new Date(Date.now() + 3600_000), ...over });

test('forgot-password answers identically for real and unknown accounts, even when the mail server is down', async () => {
  const real = await post('/api/account/forgot-password', { emailOrHandle: 'real@x.com' });
  const unknown = await post('/api/account/forgot-password', { emailOrHandle: 'ghost@x.com' });
  assert.equal(real.status, 200);
  assert.equal(unknown.status, 200);
  assert.deepEqual(await real.json(), await unknown.json());
  assert.equal(db.tokens.length, 1); // the token for the real account was still created
});

test('a valid reset link changes the password once', async () => {
  addToken('tok-1');
  const r = await post('/api/account/reset-password', { token: 'tok-1', password: 'new-password-1' });
  assert.equal(r.status, 200);
  assert.ok(db.passwords.u1 && db.passwords.u1 !== 'new-password-1'); // stored hashed
  const again = await post('/api/account/reset-password', { token: 'tok-1', password: 'another-pass-2' });
  assert.equal(again.status, 400);
});

test('two simultaneous requests with the same link: exactly one succeeds', async () => {
  addToken('tok-2');
  const [a, b] = await Promise.all([
    post('/api/account/reset-password', { token: 'tok-2', password: 'password-AAAA' }),
    post('/api/account/reset-password', { token: 'tok-2', password: 'password-BBBB' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 400]);
});

test('a successful reset also kills the account’s other outstanding links', async () => {
  addToken('old-link'); addToken('new-link');
  assert.equal((await post('/api/account/reset-password', { token: 'new-link', password: 'password-CCCC' })).status, 200);
  const stale = await post('/api/account/reset-password', { token: 'old-link', password: 'attacker-pass-9' });
  assert.equal(stale.status, 400);
});

test('expired and too-short-password cases are refused (the auth limiter allows 10 requests per file, so keep this lean)', async () => {
  addToken('expired', { expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await post('/api/account/reset-password', { token: 'expired', password: 'password-DDDD' })).status, 400);
  addToken('short');
  assert.equal((await post('/api/account/reset-password', { token: 'short', password: 'abc' })).status, 400);
});
