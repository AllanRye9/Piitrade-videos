const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// ---- in-memory stand-in for the Prisma calls the follow route uses
const db = { follows: [], notifications: [], staleRead: false };
const same = (a, b) => a.followerSessionId === b.followerSessionId && a.followingSessionId === b.followingSessionId;
const fake = {
  sessionProfile: {
    findUnique: async ({ where }) => {
      if (where.sessionId === 'viewer' || where.sessionId === 'viewer2') return { userId: 'u1', user: { suspendedAt: null } };
      if (where.handle === 'amina') return { sessionId: 'target', handle: 'amina' };
      if (where.handle === 'me') return { sessionId: 'viewer', handle: 'me' };
      return null;
    },
  },
  follow: {
    findUnique: async ({ where }) => (db.staleRead ? null : db.follows.find((f) => same(f, where.followerSessionId_followingSessionId)) || null),
    create: async ({ data }) => {
      if (db.follows.some((f) => same(f, data))) throw Object.assign(new Error('unique'), { code: 'P2002' });
      db.follows.push({ ...data });
    },
    deleteMany: async ({ where }) => {
      const n = db.follows.length;
      db.follows = db.follows.filter((f) => !same(f, where));
      return { count: n - db.follows.length };
    },
    count: async ({ where }) => db.follows.filter((f) => f.followingSessionId === where.followingSessionId).length,
  },
  notification: {
    findFirst: async ({ where }) => db.notifications.find((n) => n.recipientSessionId === where.recipientSessionId && n.type === where.type && n.actorSessionId === where.actorSessionId) || null,
    create: async ({ data }) => { db.notifications.push({ ...data }); },
  },
};
const dbPath = require.resolve('../dist/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: fake } };

require('express-async-errors');
const express = require('express');
const accounts = require('../dist/routes/accounts');

let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/accounts', accounts.default);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => { db.follows = []; db.notifications = []; db.staleRead = false; });

const follow = (handle = 'amina', session = 'viewer') => fetch(`${base}/api/accounts/${handle}/follow`, { method: 'POST', headers: { 'x-session-id': session } });

test('follow then unfollow toggles and reports the count', async () => {
  const a = await (await follow()).json();
  assert.deepEqual(a, { following: true, followersCount: 1 });
  const b = await (await follow()).json();
  assert.deepEqual(b, { following: false, followersCount: 0 });
});

test('follow → unfollow → follow again sends ONE notification, not one per re-follow', async () => {
  await follow(); await follow(); await follow(); await follow();
  assert.equal(db.notifications.length, 1);
  await follow('amina', 'viewer2'); // a different person does notify
  assert.equal(db.notifications.length, 2);
});

test('two simultaneous follow taps no longer 500: the loser of the race gets following=true', async () => {
  db.staleRead = true; // both requests read "not following" before either wrote
  const first = await follow();
  assert.equal(first.status, 200);
  const second = await follow(); // create now hits the unique key
  assert.equal(second.status, 200);
  assert.equal((await second.json()).following, true);
  assert.equal(db.follows.length, 1);
});

test('unfollowing a row a concurrent request already removed is a no-op, not a 500', async () => {
  db.follows.push({ followerSessionId: 'viewer', followingSessionId: 'target' });
  const realFind = fake.follow.findUnique;
  fake.follow.findUnique = async () => ({ id: 'x' }); // read sees it...
  db.follows = [];                                      // ...but it's gone by the time we delete
  const r = await follow();
  fake.follow.findUnique = realFind;
  assert.equal(r.status, 200);
  assert.equal((await r.json()).following, false);
});

test('you still can’t follow yourself, and unknown accounts are 404', async () => {
  assert.equal((await follow('me')).status, 400);
  assert.equal((await follow('nobody')).status, 404);
});
