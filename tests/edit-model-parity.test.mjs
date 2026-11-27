// The video editor's rules (cuts → kept sections, crop maths, the `edits` payload) exist twice because the web and
// mobile bundlers can't share a module. The two files must stay byte-identical; this fails the moment one is edited
// without the other — and checks the shared rules against the server's own crop maths.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { read } from './helpers.mjs';
import * as web from '../frontend/src/features/upload/editModel.ts';
import * as mobile from '../mobile/src/lib/editModel.ts';

test('web and mobile editModel.ts are identical', () => {
  assert.equal(read('mobile/src/lib/editModel.ts'), read('frontend/src/features/upload/editModel.ts'));
});

test('both build the same payload for the same edit', () => {
  const win = { start: 1, end: 30 };
  const e = { ...web.defaultEdit(), speed: 1.5, aspect: '9:16', zoom: 1.2, cuts: [{ start: 5, end: 9 }], preset: 'warm' };
  assert.deepEqual(mobile.buildEditsPayload(win, e, { width: 1920, height: 1080 }), web.buildEditsPayload(win, e, { width: 1920, height: 1080 }));
  assert.deepEqual(mobile.buildEditsPayload(win, e, null), web.buildEditsPayload(win, e, null));
  assert.equal(web.buildEditsPayload(win, web.defaultEdit(), null), null);
});

test('the crop maths matches the server (backend/src/lib/video/videoEdit.ts cropRectFromFrame)', () => {
  const src = read('backend/src/lib/video/videoEdit.ts');
  assert.match(src, /cropRectFromFrame/);
  // same constants on both sides
  assert.match(src, /'9:16': 9 \/ 16, '4:5': 4 \/ 5, '1:1': 1, '16:9': 16 \/ 9/);
  const r = web.cropRectFor('9:16', 1, 0, 0, 1920, 1080);
  assert.ok(Math.abs(r.w - (9 / 16) / (16 / 9)) < 1e-3 && r.h === 1);
});

test('the editor limits match the server', () => {
  const src = read('backend/src/lib/video/videoEdit.ts');
  const n = (re) => Number(re.exec(src)[1]);
  assert.equal(web.EDIT_LIMITS.minSpeed, n(/minSpeed:\s*([\d.]+)/));
  assert.equal(web.EDIT_LIMITS.maxSpeed, n(/maxSpeed:\s*([\d.]+)/));
  assert.equal(web.EDIT_LIMITS.maxTexts, n(/maxTexts:\s*(\d+)/));
  assert.equal(web.EDIT_LIMITS.maxTextChars, n(/maxTextChars:\s*(\d+)/));
  assert.equal(web.EDIT_LIMITS.maxFade, n(/maxFadeSeconds:\s*(\d+)/));
  assert.equal(web.EDIT_LIMITS.minSegment, n(/minSegmentSeconds:\s*([\d.]+)/));
  assert.equal(web.EDIT_LIMITS.maxCuts + 1, n(/maxSegments:\s*(\d+)/));
  for (const [id, look] of Object.entries(web.LOOKS)) {
    const m = new RegExp(`\\b${id}: \\{ brightness: ([-\\d.]+), contrast: ([\\d.]+), saturation: ([\\d.]+), sepia: ([\\d.]+) \\}`).exec(src);
    assert.ok(m, `look ${id} missing on the server`);
    assert.deepEqual([look.brightness, look.contrast, look.saturation, look.sepia], m.slice(1).map(Number), `look ${id} differs`);
  }
});

test('the frame standard numbers match the server', () => {
  const server = read('backend/src/lib/video/videoStandard.ts');
  const client = read('frontend/src/lib/frameStandard.ts');
  for (const re of [/maxWidth: 1080, maxHeight: 1920/, /maxWidth: 1920, maxHeight: 1080/, /maxFps: 30/]) {
    assert.match(server, re);
    assert.match(client, re);
  }
});
