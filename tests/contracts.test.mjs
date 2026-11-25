// Contracts between the backend, the web app, the mobile app and the build setup. The same number or route
// is written in several places that cannot import each other; these tests fail the moment they drift apart
// (e.g. the app accepting a 500 MB file the server then refuses, or a build pinned to an Android SDK the
// React Native version doesn't use).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exists, matches, read, readJson } from './helpers.mjs';

const num = (text, re, what) => {
  const m = re.exec(text);
  assert.ok(m, `could not find ${what}`);
  return Number(m[1]);
};

test('the upload size limit is the same in the backend and nginx', () => {
  const upload = read('backend/src/middleware/upload.ts');
  const backendMb = num(upload, /MAX_VIDEO_UPLOAD_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/, 'backend upload limit');
  const nginxMb = num(read('frontend/nginx.conf'), /client_max_body_size\s+(\d+)M/, 'nginx body limit');
  assert.equal((upload.match(/fileSize:\s*MAX_VIDEO_UPLOAD_BYTES/g) || []).length, 2, 'both video upload handlers must use the shared limit');
  assert.equal(nginxMb, backendMb, 'nginx client_max_body_size differs from the backend limit');
});

test('the maximum video length is the same in the backend, the web app and the mobile app', () => {
  const backend = num(read('backend/src/lib/videoLimits.ts'), /MAX_VIDEO_SECONDS\s*=\s*(\d+)/, 'backend limit');
  assert.equal(num(read('frontend/src/config.ts'), /MAX_VIDEO_SECONDS\s*=\s*(\d+)/, 'web limit'), backend);
  assert.equal(num(read('mobile/src/config.ts'), /MAX_VIDEO_SECONDS\s*=\s*(\d+)/, 'mobile limit'), backend);
});

test('every /api route family the web and mobile apps call is mounted by the backend', () => {
  const mounted = new Set(matches(read('backend/src/index.ts'), /app\.use\('\/api\/([a-z-]+)'/g));
  assert.ok(mounted.size >= 10, 'expected the backend route mounts to be found');
  for (const client of ['mobile/src/api.ts', 'frontend/src/api.ts', 'frontend/src/admin/adminApi.ts']) {
    if (!exists(client)) continue;
    const called = matches(read(client), /\/api\/([a-z-]+)/g);
    assert.ok(called.length > 0, `${client}: no API calls found`);
    for (const family of called) assert.ok(mounted.has(family), `${client} calls /api/${family}, which the backend does not mount`);
  }
});

test('analytics event types are the same on web and mobile, and the backend accepts them', () => {
  const web = matches(read('frontend/src/analytics.ts'), /type:\s*'([a-z-]+)'/g).sort();
  const mobile = matches(read('mobile/src/lib/analytics.ts'), /type:\s*'([a-z-]+)'/g).sort();
  assert.ok(web.length > 0 && mobile.length > 0, 'expected event types in both clients');
  assert.deepEqual(mobile, web, 'web and mobile send different analytics event types');
  const backend = read('backend/src/routes/events.ts');
  for (const type of web) assert.ok(backend.includes(`'${type}'`), `the backend does not handle the "${type}" event`);
});

test('mobile upload retries use the backend idempotency key contract', () => {
  const mobile = read('mobile/src/api.ts');
  const backend = read('backend/src/routes/videos.ts');
  assert.match(mobile, /setRequestHeader\('X-Idempotency-Key'/);
  assert.match(backend, /req\.header\('x-idempotency-key'\)/);
  assert.match(backend, /where:\s*\{\s*uploadKey:\s*key\s*\}/);
  assert.match(read('backend/prisma/schema.prisma'), /uploadKey\s+String\?\s+@unique/);
});

test('every error code the backend throws for uploads has a message path on the app side', () => {
  // The app shows the server's own message, so what matters is that the codes the app branches on exist.
  const backend = read('backend/src/routes/videos.ts') + read('backend/src/lib/videoLimits.ts');
  for (const code of matches(read('mobile/src/state/uploads.ts') + read('mobile/src/api.ts'), /code\s*===\s*'([A-Z_]+)'/g)) {
    if (code === 'UPLOAD_INTERRUPTED' || code === 'SIGN_IN_REQUIRED') continue; // raised by the app / a different router
    assert.ok(backend.includes(`'${code}'`), `the app branches on "${code}" but the backend never sends it`);
  }
});

// ---- Android build setup ----

const workflow = read('.github/workflows/android-apk.yml');
const buildProps = readJson('mobile/app.json').expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-build-properties')?.[1]?.android;

test('the APK workflow installs the same Android SDK the app is configured to build against', () => {
  assert.ok(buildProps, 'app.json has no expo-build-properties android block');
  const platforms = matches(workflow, /platforms;android-(\d+)/g).map(Number);
  const tools = matches(workflow, /build-tools;([\d.]+)/g);
  assert.ok(platforms.includes(buildProps.compileSdkVersion), `workflow installs platforms ${platforms}, app compiles against ${buildProps.compileSdkVersion}`);
  assert.deepEqual(tools, [buildProps.buildToolsVersion], 'workflow build-tools differ from app.json buildToolsVersion');
  assert.ok(buildProps.targetSdkVersion <= buildProps.compileSdkVersion, 'targetSdk is above compileSdk');
});

test('the Android SDK, build-tools and NDK match what the installed React Native requires', { skip: !exists('mobile/node_modules/react-native/gradle/libs.versions.toml') }, () => {
  const toml = read('mobile/node_modules/react-native/gradle/libs.versions.toml');
  const get = (key) => new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm').exec(toml)?.[1];
  assert.equal(String(buildProps.compileSdkVersion), get('compileSdk'), 'compileSdk differs from React Native');
  assert.equal(buildProps.buildToolsVersion, get('buildTools'), 'buildTools differs from React Native');
  assert.ok(workflow.includes(`ndk;${get('ndkVersion')}`), `workflow NDK differs from React Native's ${get('ndkVersion')}`);
});

test('the APK workflow runs cheap checks before the native build and keeps diagnostics on failure', () => {
  const at = (needle) => workflow.indexOf(needle);
  assert.ok(at('npm run typecheck') > 0 && at('npm test') > 0 && at('assembleRelease') > 0);
  assert.ok(at('npm run typecheck') < at('assembleRelease') && at('npm test') < at('assembleRelease'), 'checks must run before the native build');
  assert.match(workflow, /if: failure\(\)/);
  assert.match(workflow, /reactNativeArchitectures/);
});

test('CI runs typecheck and tests for backend, web and mobile, plus these repo-level tests', () => {
  const ci = read('.github/workflows/ci.yml');
  for (const job of ['backend', 'frontend', 'mobile', 'repo']) assert.match(ci, new RegExp(`^  ${job}:`, 'm'), `ci.yml has no "${job}" job`);
  assert.ok((ci.match(/npm test/g) || []).length >= 3, 'ci.yml should run npm test for each package');
  assert.match(ci, /npm run test:root/, 'ci.yml does not run the repo-level tests');
});
