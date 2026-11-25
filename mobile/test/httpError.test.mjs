import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeBadSuccessBody, describeHttpFailure, hostLabel, looksLikeHtml, parseErrorBody } from '../src/lib/httpError.ts';

const base = 'https://v.piitrade.com';
const call = (status, body) => describeHttpFailure({ method: 'GET', path: '/api/videos', status, base, body });

test('the server’s own error message always wins', () => {
  const r = call(404, JSON.stringify({ error: 'Video not found' }));
  assert.equal(r.message, 'GET /api/videos: Video not found');
  assert.equal(describeHttpFailure({ method: 'POST', path: '/api/videos/1/like', status: 401, base, body: JSON.stringify({ error: 'Sign in', code: 'SIGN_IN_REQUIRED' }) }).fields?.code, 'SIGN_IN_REQUIRED');
});

test('an HTML 404 is reported as a wrong or misrouted server, naming the host', () => {
  const r = call(404, '<!DOCTYPE html><html><body>Not Found</body></html>');
  assert.match(r.message, /^GET \/api\/videos: HTTP 404 — v\.piitrade\.com has no such endpoint/);
  assert.match(r.message, /wrong server/);
  assert.equal(r.fields, null);
  assert.match(call(404, '').message, /no such endpoint/);
});

test('gateway errors say the server is unavailable; other statuses keep the status and host', () => {
  for (const s of [502, 503, 504]) assert.match(call(s, 'Bad Gateway').message, new RegExp(`HTTP ${s} — the server at v\\.piitrade\\.com is unavailable`));
  assert.equal(call(500, '').message, 'GET /api/videos: HTTP 500 (v.piitrade.com)');
  assert.match(call(403, '<html></html>').message, /web page instead of the API/);
});

test('a 2xx answer that is a web page is reported as /api not being routed to the backend', () => {
  const html = describeBadSuccessBody({ method: 'GET', path: '/api/videos', status: 200, base, body: '<!doctype html><html></html>' });
  assert.match(html, /returned a web page instead of API data/);
  assert.match(html, /not routed to the backend/);
  assert.match(describeBadSuccessBody({ method: 'GET', path: '/api/videos', status: 200, base, body: 'oops' }), /invalid JSON response from v\.piitrade\.com/);
});

test('parseErrorBody only accepts JSON objects and picks out the known fields', () => {
  assert.deepEqual(parseErrorBody('{"error":"x","code":"VIDEO_TOO_LONG","duration":75.5,"maxSeconds":60,"extra":1}'), { error: 'x', message: undefined, code: 'VIDEO_TOO_LONG', duration: 75.5, maxSeconds: 60 });
  assert.equal(parseErrorBody('[1,2]'), null);
  assert.equal(parseErrorBody('"text"'), null);
  assert.equal(parseErrorBody('<html>'), null);
  assert.equal(parseErrorBody(''), null);
  assert.equal(parseErrorBody(undefined), null);
});

test('looksLikeHtml and hostLabel', () => {
  assert.equal(looksLikeHtml('  <!DOCTYPE html>'), true);
  assert.equal(looksLikeHtml('<html lang="en">'), true);
  assert.equal(looksLikeHtml('{"error":"x"}'), false);
  assert.equal(looksLikeHtml(undefined), false);
  assert.equal(hostLabel('https://v.piitrade.com'), 'v.piitrade.com');
  assert.equal(hostLabel('http://10.0.2.2:4000'), '10.0.2.2:4000');
  assert.equal(hostLabel('https://staging.example.com/backend'), 'staging.example.com');
});
