const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
require('express-async-errors');
const express = require('express');
const sharp = require('sharp');
const { uploadImage } = require('../dist/middleware/upload');
const { toJpeg } = require('../dist/lib/image');
const { HttpError } = require('../dist/lib/httpError');

// Same middleware chain as POST /api/profile/avatar (multer filter → toJpeg), without the database.
let server, base;
before(async () => {
  const app = express();
  app.post('/avatar', uploadImage.single('avatar'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'An avatar image is required');
    const out = await toJpeg(req.file.buffer, { square: 512 });
    const m = await sharp(out).metadata();
    res.status(201).json({ format: m.format, w: m.width, h: m.height });
  });
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const heic = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.heic'));
function send(bytes, { type, name }) {
  const form = new FormData();
  form.append('avatar', new Blob([bytes], type ? { type } : {}), name);
  return fetch(`${base}/avatar`, { method: 'POST', body: form });
}

test('HEIC is accepted however the phone labels it (image/heic, image/heif, octet-stream, none)', async () => {
  for (const type of ['image/heic', 'image/heif', 'application/octet-stream', '']) {
    const r = await send(heic, { type, name: 'IMG_0001.HEIC' });
    assert.equal(r.status, 201, `type "${type}"`);
    assert.deepEqual(await r.json(), { format: 'jpeg', w: 512, h: 512 });
  }
});

test('a JPEG sent with a wrong extension and generic type still works', async () => {
  const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  assert.equal((await send(jpeg, { type: 'application/octet-stream', name: 'avatar.bin' })).status, 201);
});

test('non-images are refused with a readable message', async () => {
  const pdf = await send(Buffer.from('%PDF-1.7 hello'), { type: 'application/pdf', name: 'a.pdf' });
  assert.equal(pdf.status, 400);
  assert.match((await pdf.json()).error, /image/i);
  const fake = await send(Buffer.from('this is just text pretending to be a photo'), { type: 'image/jpeg', name: 'a.jpg' });
  assert.equal(fake.status, 400);
  assert.match((await fake.json()).error, /isn’t supported|JPEG, PNG, WebP or HEIC/);
});
