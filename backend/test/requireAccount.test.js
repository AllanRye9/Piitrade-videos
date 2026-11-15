const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Stub the db module so the test needs no generated Prisma client or database.
const prisma = { sessionProfile: { findUnique: async () => null } };
const dbPath = require.resolve('../dist/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma } };
const { requireAccount } = require('../dist/middleware/requireAccount');

const req = (id) => ({ header: (n) => (n.toLowerCase() === 'x-session-id' ? id : undefined) });
const run = async (id) => {
  let nexted = false;
  try {
    await requireAccount(req(id), {}, () => { nexted = true; });
    return { nexted };
  } catch (err) {
    return { nexted, err };
  }
};

test('guest sessions (no linked account) get 401 SIGN_IN_REQUIRED', async () => {
  prisma.sessionProfile.findUnique = async () => null;
  const { nexted, err } = await run('guest-1');
  assert.equal(nexted, false);
  assert.equal(err.status, 401);
  assert.equal(err.code, 'SIGN_IN_REQUIRED');

  prisma.sessionProfile.findUnique = async () => ({ userId: null });
  assert.equal((await run('guest-2')).err.status, 401);
});

test('sessions linked to an account pass through', async () => {
  prisma.sessionProfile.findUnique = async () => ({ userId: 'user-1' });
  assert.equal((await run('member-1')).nexted, true);
});

test('missing session header is a 400', async () => {
  assert.equal((await run(undefined)).err.status, 400);
});
