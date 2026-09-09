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
function resolveAvatarUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `/uploads/avatars/${value}`;
}

// GET /api/profile — this session's profile (currently just the avatar)
router.get('/', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const profile = await prisma.sessionProfile.findUnique({ where: { sessionId } });
  res.json({ avatar: profile?.avatar ? resolveAvatarUrl(profile.avatar) : null });
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
