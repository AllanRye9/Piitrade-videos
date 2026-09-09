import ImageKit from 'imagekit';
import { HttpError } from './httpError';

/**
 * Two independently-configured ImageKit destinations:
 *
 *   VIDEO_STORE   — uploaded videos + their poster frames
 *   IMAGES_POINT  — profile/avatar images
 *
 * Each is set via its own ImageKit URL endpoint env var. Upload auth
 * (public/private key) is shared across both by default via
 * IMAGEKIT_PUBLIC_KEY / IMAGEKIT_PRIVATE_KEY, since ImageKit's Upload
 * API auths per-account, not per-URL-endpoint — folders (not separate
 * endpoints) are ImageKit's own mechanism for organizing files within
 * one account. If VIDEO_STORE and IMAGES_POINT actually belong to two
 * *different* ImageKit accounts, override per-store keys with
 * VIDEO_STORE_PUBLIC_KEY/VIDEO_STORE_PRIVATE_KEY or
 * IMAGES_POINT_PUBLIC_KEY/IMAGES_POINT_PRIVATE_KEY.
 *
 * Either store is entirely optional — when its URL endpoint env var is
 * unset, callers fall back to local disk storage (see routes/videos.ts
 * and routes/profile.ts), same pattern as AI_SEARCH/MARKETPLACE_API.
 */

export type StoreName = 'VIDEO_STORE' | 'IMAGES_POINT';

interface StoreConfig {
  urlEndpoint: string;
  publicKey: string;
  privateKey: string;
}

function readStoreConfig(store: StoreName): StoreConfig | null {
  const urlEndpoint = process.env[store];
  if (!urlEndpoint || !urlEndpoint.trim()) return null;

  const publicKey = process.env[`${store}_PUBLIC_KEY`] || process.env.IMAGEKIT_PUBLIC_KEY;
  const privateKey = process.env[`${store}_PRIVATE_KEY`] || process.env.IMAGEKIT_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new HttpError(
      503,
      `${store} is set but no ImageKit keys were found (set IMAGEKIT_PUBLIC_KEY/IMAGEKIT_PRIVATE_KEY, ` +
        `or ${store}_PUBLIC_KEY/${store}_PRIVATE_KEY if ${store} is a different ImageKit account)`
    );
  }
  return { urlEndpoint: urlEndpoint.trim(), publicKey, privateKey };
}

const clients = new Map<StoreName, ImageKit>();

function clientFor(store: StoreName): ImageKit | null {
  const config = readStoreConfig(store);
  if (!config) return null;
  let client = clients.get(store);
  if (!client) {
    client = new ImageKit(config);
    clients.set(store, client);
  }
  return client;
}

export function isStoreConfigured(store: StoreName): boolean {
  return Boolean(process.env[store]?.trim());
}

export interface UploadedAsset {
  url: string;
  fileId: string;
}

/**
 * Uploads a buffer to the given store under `folder` (e.g. "videos",
 * "posters", "avatars"). Returns null if the store isn't configured —
 * callers use that to fall back to local disk rather than throwing,
 * since ImageKit is optional infrastructure here.
 */
export async function uploadToStore(
  store: StoreName,
  buffer: Buffer,
  fileName: string,
  folder: string
): Promise<UploadedAsset | null> {
  const client = clientFor(store);
  if (!client) return null;

  try {
    const result = await client.upload({
      file: buffer,
      fileName,
      folder: `/${folder}`,
      useUniqueFileName: true,
    });
    return { url: result.url, fileId: result.fileId };
  } catch (err) {
    throw new HttpError(502, `Upload to ${store} failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
}

/** Best-effort delete — used when replacing/removing an asset. Never throws; a failed cleanup shouldn't block the caller's own response. */
export async function deleteFromStore(store: StoreName, fileId: string): Promise<void> {
  const client = clientFor(store);
  if (!client) return;
  try {
    await client.deleteFile(fileId);
  } catch (err) {
    console.warn(`Failed to delete ${fileId} from ${store}:`, err instanceof Error ? err.message : err);
  }
}
