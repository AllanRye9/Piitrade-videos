const { test } = require('node:test');
const assert = require('node:assert/strict');

// requireAdmin imports the db module; stub it so no Prisma client/database is needed.
const dbPath = require.resolve('../dist/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: {} } };

const { normalizePermissions, ALL_PERMISSIONS } = require('../dist/lib/permissions');
const { requirePermission, requirePrimary, toCurrentAdmin } = require('../dist/middleware/requireAdmin');

test('normalizePermissions drops unknown values and non-arrays', () => {
  assert.deepEqual(normalizePermissions('videos.delete'), []);
  assert.deepEqual(normalizePermissions(['nope.view', 'users.fly']), []);
});

test('any write permission implies view on the same resource', () => {
  assert.deepEqual(normalizePermissions(['videos.delete']), ['videos.view', 'videos.delete']);
  assert.deepEqual(normalizePermissions(['users.edit', 'users.create']), ['users.view', 'users.create', 'users.edit']);
});

test('normalizePermissions de-duplicates and keeps catalogue order', () => {
  const out = normalizePermissions(['products.delete', 'users.view', 'users.view']);
  assert.deepEqual(out, ['users.view', 'products.view', 'products.delete']);
});

test('admins/audit are not grantable permissions', () => {
  assert.ok(!ALL_PERMISSIONS.some((p) => p.startsWith('admins.') || p.startsWith('audit.')));
  assert.deepEqual(normalizePermissions(['admins.create']), []);
});

test('primary admin implicitly holds every permission; secondary only what was granted', () => {
  const primary = toCurrentAdmin({ id: '1', email: 'p@x.com', name: '', role: 'PRIMARY', permissions: [] });
  assert.deepEqual(primary.permissions, ALL_PERMISSIONS);
  const sec = toCurrentAdmin({ id: '2', email: 's@x.com', name: '', role: 'SECONDARY', permissions: ['videos.view'] });
  assert.deepEqual(sec.permissions, ['videos.view']);
});

function run(mw, admin) {
  let nexted = false;
  let status = null;
  const res = { status: (s) => ((status = s), res), json: () => res };
  mw({ admin }, res, () => { nexted = true; });
  return { nexted, status };
}

test('requirePermission allows holders and blocks everyone else with 403', () => {
  const guard = requirePermission('videos.delete');
  const sec = toCurrentAdmin({ id: '2', email: 's@x.com', name: '', role: 'SECONDARY', permissions: ['videos.view'] });
  assert.deepEqual(run(guard, sec), { nexted: false, status: 403 });
  const allowed = toCurrentAdmin({ id: '3', email: 'a@x.com', name: '', role: 'SECONDARY', permissions: ['videos.view', 'videos.delete'] });
  assert.equal(run(guard, allowed).nexted, true);
  const primary = toCurrentAdmin({ id: '1', email: 'p@x.com', name: '', role: 'PRIMARY', permissions: [] });
  assert.equal(run(guard, primary).nexted, true);
});

test('requirePrimary rejects secondary admins', () => {
  const sec = toCurrentAdmin({ id: '2', email: 's@x.com', name: '', role: 'SECONDARY', permissions: ALL_PERMISSIONS });
  assert.deepEqual(run(requirePrimary, sec), { nexted: false, status: 403 });
  const primary = toCurrentAdmin({ id: '1', email: 'p@x.com', name: '', role: 'PRIMARY', permissions: [] });
  assert.equal(run(requirePrimary, primary).nexted, true);
});
