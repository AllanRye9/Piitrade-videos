const assert = require('node:assert/strict');
const { test } = require('node:test');
const { corsOptions } = require('../dist/lib/cors.js');

function isAllowed(origin) {
  return new Promise((resolve, reject) => {
    corsOptions().origin(origin, (error, allowed) => {
      if (error) reject(error);
      else resolve(allowed);
    });
  });
}

test('unset ALLOWED_ORIGIN permits any origin', async () => {
  const previous = process.env.ALLOWED_ORIGIN;
  delete process.env.ALLOWED_ORIGIN;
  try {
    assert.equal(await isAllowed('https://anywhere.example'), true);
  } finally {
    if (previous === undefined) delete process.env.ALLOWED_ORIGIN;
    else process.env.ALLOWED_ORIGIN = previous;
  }
});

test('configured origins retain production, WebView, and local development access', async () => {
  const previous = process.env.ALLOWED_ORIGIN;
  process.env.ALLOWED_ORIGIN = 'https://app.example';
  try {
    assert.equal(await isAllowed('https://app.example'), true);
    assert.equal(await isAllowed('https://yotweek.com'), true);
    assert.equal(await isAllowed('capacitor://localhost'), true);
    assert.equal(await isAllowed('http://localhost:5173'), true);
    assert.equal(await isAllowed('https://unlisted.example'), false);
  } finally {
    if (previous === undefined) delete process.env.ALLOWED_ORIGIN;
    else process.env.ALLOWED_ORIGIN = previous;
  }
});
