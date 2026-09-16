import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { prisma } from '../db';
import { uploadImage } from '../middleware/upload';
import { uploadToStore } from '../lib/imagekit';
import { AVATARS_DIR } from '../paths';
import { HttpError } from '../lib/httpError';

const router = Router();

function getSessionId(req: Request): string {
  const id = req.header('x-session-id');
  if (!id || !id.trim()) throw new HttpError(400, 'Missing X-Session-Id header');
  return id.trim();
}

// A stored avatar value is either a local disk filename (served from
// /uploads/avatars/...) or, when IMAGES_POINT is configured, a full
// ImageKit URL — same pattern as Video.filename in routes/videos.ts.
export function resolveAvatarUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `/uploads/avatars/${value}`;
}

const MAX_DISPLAY_NAME_LENGTH = 40;
const MAX_BIO_LENGTH = 160;
const MAX_HANDLE_LENGTH = 30;
const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_HANDLE_LENGTH - 5);
}

/**
 * Every uploader needs a public, unique handle to be discoverable at
 * /u/:handle — but sessions are otherwise anonymous, so nothing
 * guarantees one exists yet. Called lazily (first upload, or first
 * touch of the account-discovery routes below) rather than at profile
 * creation time, since most sessions never upload and so never need
 * a public handle at all.
 */
export async function ensureHandle(sessionId: string): Promise<string> {
  const existing = await prisma.sessionProfile.findUnique({ where: { sessionId } });
  if (existing?.handle) return existing.handle;

  const base = slugify(existing?.displayName || '') || 'creator';
  // Try the plain slug first, then fall back to short random suffixes
  // until an unused handle is found — collisions are expected (lots of
  // "creator"s) but should be rare enough that a handful of attempts
  // always succeeds.
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      await prisma.sessionProfile.upsert({
        where: { sessionId },
        update: { handle: candidate },
        create: { sessionId, handle: candidate },
      });
      return candidate;
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err; // unique constraint — try again with a suffix
    }
  }
  throw new HttpError(500, 'Could not assign a public handle — please try again');
}

// GET /api/profile — this session's profile (avatar + display name + handle + bio)
router.get('/', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const profile = await prisma.sessionProfile.findUnique({ where: { sessionId } });
  res.json({
    avatar: profile?.avatar ? resolveAvatarUrl(profile.avatar) : null,
    displayName: profile?.displayName || null,
    handle: profile?.handle || null,
    bio: profile?.bio || null,
  });
});

// PUT /api/profile  { displayName?, bio? }  — each omitted key is left
// untouched; passing null (or '') for a given key clears it.
router.put('/', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const { displayName, bio } = req.body || {};
  if (displayName !== undefined && displayName !== null && typeof displayName !== 'string') {
    throw new HttpError(400, 'displayName must be a string or null');
  }
  if (bio !== undefined && bio !== null && typeof bio !== 'string') {
    throw new HttpError(400, 'bio must be a string or null');
  }

  const data: { displayName?: string | null; bio?: string | null } = {};
  if (displayName !== undefined) data.displayName = (displayName || '').trim().slice(0, MAX_DISPLAY_NAME_LENGTH) || null;
  if (bio !== undefined) data.bio = (bio || '').trim().slice(0, MAX_BIO_LENGTH) || null;

  const profile = await prisma.sessionProfile.upsert({
    where: { sessionId },
    update: data,
    create: { sessionId, ...data },
  });

  res.json({ displayName: profile.displayName, bio: profile.bio });
});

// PUT /api/profile/handle  { handle: string }
router.put('/handle', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const handle = String(req.body?.handle || '').trim().toLowerCase();
  if (!HANDLE_PATTERN.test(handle)) {
    throw new HttpError(400, 'Handle must be 3-30 lowercase letters, numbers, or hyphens, and cannot start/end with a hyphen');
  }
  try {
    const profile = await prisma.sessionProfile.upsert({
      where: { sessionId },
      update: { handle },
      create: { sessionId, handle },
    });
    res.json({ handle: profile.handle });
  } catch (err: any) {
    if (err?.code === 'P2002') throw new HttpError(409, 'That handle is already taken');
    throw err;
  }
});

// POST /api/profile/avatar  (multipart: avatar)
router.post('/avatar', uploadImage.single('avatar'), async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const file = req.file;
  if (!file) throw new HttpError(400, 'An avatar image is required');

  // Normalize to a square JPEG thumbnail — avatars are shown small and
  // consistently, so there's no reason to store (or re-transfer, on
  // every profile load) an arbitrarily large original.
  const sharp = (await import('sharp')).default;
  const buffer = await sharp(file.buffer)
    .resize(512, 512, { fit: 'cover' })
    .jpeg({ quality: 88 })
    .toBuffer();

  const filename = `${uuid()}.jpg`;
  const existing = await prisma.sessionProfile.findUnique({ where: { sessionId } });

  // Same resilience posture as VIDEO_STORE in routes/videos.ts: if
  // IMAGES_POINT is configured but the upload call itself fails
  // (network, auth, quota), fall back to local disk rather than
  // failing the whole avatar update over a storage hiccup.
  let storedValue = filename;
  let uploaded: Awaited<ReturnType<typeof uploadToStore>> = null;
  try {
    uploaded = await uploadToStore('IMAGES_POINT', buffer, filename, 'avatars');
  } catch (err) {
    console.warn('IMAGES_POINT upload failed, keeping local copy:', err instanceof Error ? err.message : err);
  }
  if (uploaded) {
    storedValue = uploaded.url;
  } else {
    fs.writeFileSync(path.join(AVATARS_DIR, filename), buffer);
  }

  // Clean up the previous avatar, whichever store it lived in, now
  // that the new one has been saved successfully.
  if (existing?.avatar) {
    if (/^https?:\/\//i.test(existing.avatar)) {
      // Best-effort: we don't keep ImageKit fileIds around, so a
      // previous remote avatar is simply orphaned rather than deleted.
      // Acceptable for a small per-session avatar; revisit if this
      // needs to scale to storing fileIds for cleanup.
    } else {
      const oldPath = path.join(AVATARS_DIR, existing.avatar);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
  }

  await prisma.sessionProfile.upsert({
    where: { sessionId },
    update: { avatar: storedValue },
    create: { sessionId, avatar: storedValue },
  });

  res.status(201).json({ avatar: resolveAvatarUrl(storedValue) });
});

// DELETE /api/profile/avatar — remove this session's avatar
router.delete('/avatar', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const existing = await prisma.sessionProfile.findUnique({ where: { sessionId } });
  if (existing?.avatar && !/^https?:\/\//i.test(existing.avatar)) {
    const oldPath = path.join(AVATARS_DIR, existing.avatar);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  await prisma.sessionProfile.updateMany({ where: { sessionId }, data: { avatar: null } });
  res.status(204).end();
});

export default router;
