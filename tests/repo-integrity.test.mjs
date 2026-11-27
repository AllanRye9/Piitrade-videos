// Repo-level sanity checks. Each one guards against a mistake that has really happened or easily could:
// leftover merge-conflict markers (they broke every build once), unregistered test files that silently
// never run, and settings the code reads but no one documented.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { abs, exists, matches, read, readJson, walk } from './helpers.mjs';

const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|sh|conf|prisma|sql|css|html|txt|example)$/;
const files = walk();

test('no merge-conflict markers anywhere in the source tree', () => {
  const offenders = [];
  for (const f of files) {
    if (!TEXT_EXT.test(f) || /package-lock\.json$/.test(f) || f.startsWith('tests/')) continue;
    if (fs.statSync(abs(f)).size > 2 * 1024 * 1024) continue;
    if (/^(<{7} |>{7} )/m.test(read(f))) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `unresolved merge conflict in: ${offenders.join(', ')}`);
});

test('every package.json is valid JSON with a name', () => {
  const pkgs = files.filter((f) => f.endsWith('package.json'));
  assert.ok(pkgs.length >= 4, 'expected root, backend, frontend and mobile packages');
  for (const f of pkgs) {
    const json = readJson(f);
    assert.ok(typeof json.name === 'string' && json.name, `${f} has no name`);
  }
});

test('backend, web and mobile each define typecheck and test scripts', () => {
  for (const pkg of ['backend', 'frontend', 'mobile']) {
    const { scripts } = readJson(`${pkg}/package.json`);
    assert.ok(scripts.test, `${pkg}: no test script`);
    assert.ok(scripts.typecheck, `${pkg}: no typecheck script`);
  }
});

test('every logic test file is registered in its package test:logic script (an unregistered test never runs)', () => {
  for (const pkg of ['frontend', 'mobile']) {
    const script = readJson(`${pkg}/package.json`).scripts['test:logic'];
    const testFiles = files.filter((f) => f.startsWith(`${pkg}/test/`) && /\.test\.mjs$/.test(f));
    assert.ok(testFiles.length > 0, `${pkg}: no logic tests found`);
    for (const f of testFiles) {
      const rel = f.slice(pkg.length + 1);
      assert.ok(script.includes(rel), `${pkg}: ${rel} is not in test:logic`);
    }
  }
});

test('the backend test script discovers every test file (plain `node --test` over test/)', () => {
  assert.equal(readJson('backend/package.json').scripts.test, 'node --test');
  const stray = files.filter((f) => f.startsWith('backend/src/') && /\.test\.[jt]s$/.test(f));
  assert.deepEqual(stray, [], 'tests inside backend/src would not be run');
});

test('.gitignore keeps dependencies, build output, env files and TypeScript build caches out of the repo', () => {
  const lines = read('.gitignore').split(/\r?\n/).map((l) => l.trim());
  for (const entry of ['node_modules/', 'dist/', '.env', '*.tsbuildinfo']) {
    assert.ok(lines.includes(entry), `.gitignore is missing "${entry}"`);
  }
});

test('every upload/transcode setting the backend reads is documented in .env.example', () => {
  const used = new Set();
  for (const f of files.filter((f) => f.startsWith('backend/src/') && f.endsWith('.ts'))) {
    for (const name of matches(read(f), /process\.env\.((?:TRANSCODE|UPLOAD)_[A-Z_]+)/g)) used.add(name);
  }
  assert.ok(used.size > 0, 'expected the upload settings to be found');
  const documented = read('backend/.env.example');
  for (const name of used) assert.ok(documented.includes(name), `${name} is read by the backend but missing from .env.example`);
});

test('the shared helper files the tests rely on exist', () => {
  for (const f of ['backend/src/index.ts', 'mobile/src/api.ts', 'frontend/src/lib/api.ts', 'frontend/nginx.conf', '.github/workflows/ci.yml', '.github/workflows/android-apk.yml']) {
    assert.ok(exists(f), `${f} is missing`);
  }
});
