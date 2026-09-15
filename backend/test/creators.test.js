// Regression tests for GET /api/creators and GET /api/creators/:sessionId.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const FAKE_VIDEOS = [
  { id: 'v1', title: 'First video', posterFilename: 'v1.jpg', filename: 'v1.mp4', likes: 10, views: 100, comments: 2, createdAt: new Date('2026-01-01'), uploaderSessionId: 'creator-a' },
  { id: 'v2', title: 'Second video', posterFilename: 'v2.jpg', filename: 'v2.mp4', likes: 5, views: 50, comments: 1, createdAt: new Date('2026-01-02'), uploaderSessionId: 'creator-a' },
  { id: 'v3', title: 'Solo video', posterFilename: null, filename: 'v3.mp4', likes: 1, views: 20, comments: 0, createdAt: new Date('2026-01-03'), uploaderSessionId: 'creator-b' },
  { id: 'v4', title: 'No uploader (seeded)', posterFilename: 'v4.jpg', filename: 'v4.mp4', likes: 0, views: 5, comments: 0, createdAt: new Date('2026-01-04'), uploaderSessionId: null },
];

const FAKE_PROFILES = [{ sessionId: 'creator-a', displayName: 'Alice', avatar: 'alice.png' }];
// creator-b deliberately has no SessionProfile row — must not crash.

function createFakePrisma() {
  return {
    video: {
      groupBy: async ({ where, orderBy }) => {
        const filtered = FAKE_VIDEOS.filter((v) => (where?.uploaderSessionId?.not === null ? v.uploaderSessionId !== null : true));
        const bySession = new Map();
        for (const v of filtered) {
          const list = bySession.get(v.uploaderSessionId) || [];
          list.push(v);
          bySession.set(v.uploaderSessionId, list);
        }
        let groups = Array.from(bySession.entries()).map(([uploaderSessionId, vids]) => ({
          uploaderSessionId,
          _count: { _all: vids.length },
          _sum: { likes: vids.reduce((s, v) => s + v.likes, 0), views: vids.reduce((s, v) => s + v.views, 0) },
        }));
        if (orderBy?._count?.uploaderSessionId === 'desc') {
          groups = groups.sort((a, b) => b._count._all - a._count._all);
        }
        return groups;
      },
      findMany: async ({ where }) => FAKE_VIDEOS.filter((v) => v.uploaderSessionId === where.uploaderSessionId).sort((a, b) => b.createdAt - a.createdAt),
    },
    sessionProfile: {
      findMany: async ({ where }) => FAKE_PROFILES.filter((p) => where.sessionId.in.includes(p.sessionId)),
      findUnique: async ({ where }) => FAKE_PROFILES.find((p) => p.sessionId === where.sessionId) || null,
    },
  };
}

const dbPath = path.resolve(__dirname, '../dist/db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: createFakePrisma() } };

let server;
let base;

before(async () => {
  require('express-async-errors');
  const express = require('express');
  const creatorsRouter = require('../dist/routes/creators.js').default;
  const { HttpError } = require('../dist/lib/httpError.js');

  const app = express();
  app.use('/api/creators', creatorsRouter);
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  });

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(() => server.close());

test('GET /api/creators lists uploaders sorted by video count, excluding videos with no uploader', async () => {
  const res = await fetch(`${base}/api/creators`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.creators.length, 2, 'only creator-a and creator-b have uploaded videos');
  assert.equal(body.creators[0].sessionId, 'creator-a', 'creator-a has more videos and should be first');
  assert.equal(body.creators[0].videoCount, 2);
  assert.equal(body.creators[0].totalLikes, 15);
  assert.equal(body.creators[0].displayName, 'Alice');
  assert.equal(body.creators[0].avatar, '/uploads/avatars/alice.png');
});

test('a creator with no SessionProfile row still appears, with null name/avatar instead of crashing', async () => {
  const res = await fetch(`${base}/api/creators`);
  const body = await res.json();
  const creatorB = body.creators.find((c) => c.sessionId === 'creator-b');
  assert.ok(creatorB, 'creator-b should still be listed');
  assert.equal(creatorB.displayName, null);
  assert.equal(creatorB.avatar, null);
});

test('GET /api/creators/:sessionId returns the creator profile and their videos', async () => {
  const res = await fetch(`${base}/api/creators/creator-a`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.creator.displayName, 'Alice');
  assert.equal(body.creator.videoCount, 2);
  assert.equal(body.creator.totalViews, 150);
  assert.equal(body.videos.length, 2);
  assert.equal(body.videos[0].id, 'v2', 'videos should be most recent first');
  assert.ok(body.videos[0].poster, 'each video summary must include a poster/thumbnail URL');
});

test('GET /api/creators/:sessionId for a session that never uploaded returns HTTP 404', async () => {
  const res = await fetch(`${base}/api/creators/nobody-ever-uploaded`);
  assert.equal(res.status, 404);
});
