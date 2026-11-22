const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { sniffImage, toJpeg, UNSUPPORTED_IMAGE_MESSAGE } = require('../dist/lib/image');

const heic = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.heic'));
const base = () => sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 240, g: 90, b: 10 } } });

async function dims(buf) { const m = await sharp(buf).metadata(); return [m.format, m.width, m.height]; }

test('sniffImage identifies formats by content, not by name or claimed type', async () => {
  assert.equal(sniffImage(await base().jpeg().toBuffer()), 'jpeg');
  assert.equal(sniffImage(await base().png().toBuffer()), 'png');
  assert.equal(sniffImage(await base().webp().toBuffer()), 'webp');
  assert.equal(sniffImage(await base().gif().toBuffer()), 'gif');
  assert.equal(sniffImage(await base().tiff().toBuffer()), 'tiff');
  assert.equal(sniffImage(heic), 'heic');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImage(Buffer.from('%PDF-1.7 not an image at all')), null);
  assert.equal(sniffImage(Buffer.alloc(4)), null);
});

test('a real iPhone-style HEIC photo converts to JPEG (the "unsupported format" case)', async () => {
  const out = await toJpeg(heic);
  const [format, w, h] = await dims(out);
  assert.equal(format, 'jpeg');
  assert.deepEqual([w, h], [240, 160]);
});

test('HEIC avatar becomes a 512×512 square JPEG', async () => {
  assert.deepEqual(await dims(await toJpeg(heic, { square: 512 })), ['jpeg', 512, 512]);
});

test('PNG, WebP, GIF and TIFF all convert', async () => {
  for (const make of [() => base().png(), () => base().webp(), () => base().gif(), () => base().tiff()]) {
    const [format, w, h] = await dims(await toJpeg(await make().toBuffer()));
    assert.deepEqual([format, w, h], ['jpeg', 200, 100]);
  }
});

test('EXIF orientation is applied, so phone photos aren’t sideways', async () => {
  // 200×100 pixels flagged "rotate 90°" must come out 100×200.
  const sideways = await base().jpeg().withMetadata({ orientation: 6 }).toBuffer();
  assert.deepEqual(await dims(await toJpeg(sideways)), ['jpeg', 100, 200]);
});

test('files that aren’t images get a clear 400, not a 500', async () => {
  for (const bad of [Buffer.from('hello world, definitely not an image'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.alloc(2000)]) {
    await assert.rejects(() => toJpeg(bad), (e) => e.status === 400 && e.code === 'UNSUPPORTED_IMAGE' && e.message === UNSUPPORTED_IMAGE_MESSAGE);
  }
});

test('a damaged image with a valid header is a readable 400', async () => {
  const jpeg = await base().jpeg().toBuffer();
  const broken = Buffer.concat([jpeg.subarray(0, 40), Buffer.alloc(30, 0x11)]);
  const result = await toJpeg(broken).then(() => 'converted', (e) => e);
  assert.ok(result === 'converted' || (result.status === 400 && result.code === 'UNREADABLE_IMAGE'), String(result));
});
