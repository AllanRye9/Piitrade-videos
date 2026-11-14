import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import { HttpError } from './httpError';

/**
 * Cloudflare R2 media storage (replaces ImageKit).
 *
 * R2 speaks the S3 API, so this uses the standard AWS SDK pointed at
 * `https://<account>.r2.cloudflarestorage.com`. One bucket holds
 * everything, organised by folder prefix:
 *
 *   videos/    — transcoded MP4s
 *   posters/   — poster frames
 *   avatars/   — profile pictures
 *
 * Required env (all four, or R2 stays off and local disk is used):
 *
 *   R2_ACCOUNT_ID         Cloudflare account id
 *   R2_ACCESS_KEY_ID      R2 API token (S3 credentials) — Object Read & Write
 *   R2_SECRET_ACCESS_KEY  secret for the token above
 *   R2_BUCKET             bucket name
 *   R2_PUBLIC_URL         public base URL the bucket is served from — a custom
 *                         domain (recommended: gets Cloudflare's CDN cache) or
 *                         the bucket's r2.dev URL. No trailing slash.
 *
 * Optional:
 *   R2_ENDPOINT           override the S3 endpoint (tests / EU jurisdiction:
 *                         https://<account>.eu.r2.cloudflarestorage.com)
 *
 * R2 is optional infrastructure, same as the old ImageKit setup: when it
 * is not configured, callers fall back to local disk (see routes/videos.ts
 * and routes/profile.ts). What the DB stores is unchanged — a local
 * filename OR a full https URL — so rows written while ImageKit was in
 * use keep working until `npm run storage:migrate` moves them to R2.
 */

export type Folder = 'videos' | 'posters' | 'avatars';

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
  endpoint: string;
}

const REQUIRED = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL'] as const;

function env(name: string): string {
  return (process.env[name] || '').trim();
}

export function isR2Configured(): boolean {
  return REQUIRED.every((name) => env(name));
}

function readConfig(): R2Config | null {
  const present = REQUIRED.filter((name) => env(name));
  if (present.length === 0) return null;
  if (present.length !== REQUIRED.length) {
    // Half-configured is almost always a typo'd deploy — fail loudly
    // instead of silently writing videos to an ephemeral local disk.
    const missing = REQUIRED.filter((name) => !env(name));
    throw new HttpError(503, `R2 storage is partly configured — missing: ${missing.join(', ')}`);
  }
  const accountId = env('R2_ACCOUNT_ID');
  return {
    accountId,
    accessKeyId: env('R2_ACCESS_KEY_ID'),
    secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    bucket: env('R2_BUCKET'),
    publicUrl: env('R2_PUBLIC_URL').replace(/\/+$/, ''),
    endpoint: env('R2_ENDPOINT') || `https://${accountId}.r2.cloudflarestorage.com`,
  };
}

let cached: { config: R2Config; client: S3Client } | null = null;

function getR2(): { config: R2Config; client: S3Client } | null {
  const config = readConfig();
  if (!config) return null;
  if (!cached) {
    cached = {
      config,
      client: new S3Client({
        region: 'auto', // R2 ignores the region but the SDK requires one
        endpoint: config.endpoint,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      }),
    };
  }
  return cached;
}

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export function contentTypeFor(fileName: string): string {
  return CONTENT_TYPES[path.extname(fileName).toLowerCase()] || 'application/octet-stream';
}

/** The object key for a file: `<folder>/<fileName>`. */
export function objectKey(folder: Folder, fileName: string): string {
  return `${folder}/${fileName}`;
}

/** Public URL for an object key under the configured public base URL. */
export function publicUrlForKey(publicUrl: string, key: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * If `value` is a URL inside our own R2 public base URL, returns its
 * object key; otherwise null (a local filename, or a legacy ImageKit
 * URL that R2 knows nothing about).
 */
export function keyFromPublicUrl(publicUrl: string, value: string): string | null {
  const base = publicUrl.replace(/\/+$/, '') + '/';
  if (!value.startsWith(base)) return null;
  const rest = value.slice(base.length).split(/[?#]/)[0];
  if (!rest) return null;
  try {
    return rest.split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
}

export interface UploadedAsset {
  url: string;
  key: string;
}

/**
 * Uploads a buffer or a file on disk to R2 under `folder`. Returns null
 * when R2 isn't configured, which callers treat as "use local disk".
 * Objects are immutable (random UUID names), so they are cached for a
 * year by browsers, apps and Cloudflare's CDN.
 */
export async function uploadToR2(
  source: Buffer | { filePath: string },
  fileName: string,
  folder: Folder
): Promise<UploadedAsset | null> {
  const r2 = getR2();
  if (!r2) return null;

  const key = objectKey(folder, fileName);
  const isBuffer = Buffer.isBuffer(source);
  const stream = isBuffer ? null : fs.createReadStream(source.filePath);
  try {
    await r2.client.send(
      new PutObjectCommand({
        Bucket: r2.config.bucket,
        Key: key,
        Body: isBuffer ? source : stream!,
        ContentLength: isBuffer ? source.length : fs.statSync(source.filePath).size,
        ContentType: contentTypeFor(fileName),
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );
  } catch (err) {
    stream?.destroy();
    throw new HttpError(502, `Upload to R2 failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
  return { url: publicUrlForKey(r2.config.publicUrl, key), key };
}

/**
 * Best-effort delete of an asset by whatever the DB stored for it.
 * Anything that isn't one of our R2 URLs (local filenames, legacy
 * ImageKit URLs) is ignored. Never throws — a failed cleanup must not
 * fail the request that triggered it.
 */
export async function deleteFromR2ByUrl(value: string | null | undefined): Promise<void> {
  if (!value) return;
  const r2 = getR2();
  if (!r2) return;
  const key = keyFromPublicUrl(r2.config.publicUrl, value);
  if (!key) return;
  try {
    await r2.client.send(new DeleteObjectCommand({ Bucket: r2.config.bucket, Key: key }));
  } catch (err) {
    console.warn(`Failed to delete ${key} from R2:`, err instanceof Error ? err.message : err);
  }
}

/** The configured public base URL, or null when R2 is off. */
export function r2PublicUrl(): string | null {
  const config = readConfig();
  return config ? config.publicUrl : null;
}
