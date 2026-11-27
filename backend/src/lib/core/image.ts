import { HttpError } from './httpError';

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif' | 'heic' | 'tiff';

export const UNSUPPORTED_IMAGE_MESSAGE = 'That image format isn’t supported. Please choose a JPEG, PNG, WebP or HEIC photo.';

/**
 * Identifies an image by its leading bytes rather than the filename or the MIME type the client
 * claims — phones and some browsers report HEIC as application/octet-stream, image/heif, or nothing
 * at all, and a wrong claim shouldn't make a good photo fail (or a bad file through).
 * SVG is deliberately not accepted.
 */
export function sniffImage(buf: Buffer): ImageKind | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  const head = buf.toString('latin1', 0, 12);
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'gif';
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'webp';
  if ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0) || (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0 && buf[3] === 0x2a)) return 'tiff';
  if (head.slice(4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12);
    if (['avif', 'avis'].includes(brand)) return 'avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
  }
  return null;
}

async function heicToJpeg(input: Buffer): Promise<Buffer> {
  // heic-convert is pure JS/WASM: sharp's prebuilt binaries ship without an HEVC decoder.
  const convert = require('heic-convert') as (o: { buffer: Buffer; format: 'JPEG'; quality: number }) => Promise<ArrayBuffer | Buffer>;
  const out = await convert({ buffer: input, format: 'JPEG', quality: 0.92 });
  return Buffer.from(out as ArrayBuffer);
}

export interface JpegOptions {
  /** Cover-crop to a square of this size (avatars). Omit to keep the original dimensions. */
  square?: number;
  quality?: number;
}

/**
 * Any supported photo → JPEG, with EXIF orientation applied (phone photos are stored sideways with
 * an orientation flag; without `.rotate()` they'd display rotated because re-encoding drops the flag).
 * Throws a readable 400 for anything that isn't a decodable image.
 */
export async function toJpeg(input: Buffer, opts: JpegOptions = {}): Promise<Buffer> {
  const kind = sniffImage(input);
  if (!kind) throw new HttpError(400, UNSUPPORTED_IMAGE_MESSAGE, { code: 'UNSUPPORTED_IMAGE' });

  const sharp = (await import('sharp')).default;
  const encode = (buf: Buffer) => {
    let p = sharp(buf, { failOn: 'none' }).rotate();
    if (opts.square) p = p.resize(opts.square, opts.square, { fit: 'cover' });
    return p.jpeg({ quality: opts.quality ?? 88 }).toBuffer();
  };

  try {
    if (kind === 'heic') return await encode(await heicToJpeg(input));
    return await encode(input);
  } catch (firstErr) {
    // AVIF/HEIC variants some sharp builds can't read: HEIC gets one more try via the JS decoder.
    if (kind === 'heic') {
      console.warn('[image] HEIC decode failed', firstErr instanceof Error ? firstErr.message : firstErr);
    }
    throw new HttpError(400, 'We couldn’t read that image — it may be damaged. Try a different photo (JPEG, PNG, WebP or HEIC).', { code: 'UNREADABLE_IMAGE' });
  }
}
