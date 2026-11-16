import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../../db';
import { AuthedRequest, requirePermission } from '../../middleware/requireAdmin';
import { HttpError } from '../../lib/httpError';
import { hashPassword } from '../../lib/auth';
import { audit } from '../../lib/audit';
import { parsePage, pageMeta } from '../../lib/pagination';
import { ensureHandle, resolveAvatarUrl, removeAvatarFile } from '../profile';
import { resolveAssetUrl } from '../videos';
import { VIDEOS_DIR, POSTERS_DIR } from '../../paths';
import { removeStoredFile, recountComments, optionalId } from './helpers';

const router = Router();

// Same rule as routes/profile.ts (public /u/:handle slug).
const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function serialize(u: any, videoCount?: number) {
  const p = u.profile;
  return {
    id: u.id,
    email: u.email,
    createdAt: u.createdAt,
    suspendedAt: u.suspendedAt,
    status: u.suspendedAt ? 'suspended' : 'active',
    handle: p?.handle ?? null,
    displayName: p?.displayName ?? null,
    bio: p?.bio ?? null,
    avatar: p?.avatar ? resolveAvatarUrl(p.avatar) : null,
    locationId: p?.locationId ?? null,
    location: p?.location ? { id: p.location.id, name: p.location.name } : null,
    ...(videoCount !== undefined ? { videoCount } : {}),
  };
}

// GET /api/admin/users?q=&status=active|suspended&locationId=&page=&limit=
router.get('/', requirePermission('users.view'), async (req: AuthedRequest, res: Response) => {
  const { page, limit, skip, take } = parsePage(req);
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '');
  const locationId = String(req.query.locationId || '');

  const where: any = {};
  if (q) {
    where.OR = [
      { email: { contains: q, mode: 'insensitive' } },
      { profile: { is: { handle: { contains: q, mode: 'insensitive' } } } },
      { profile: { is: { displayName: { contains: q, mode: 'insensitive' } } } },
    ];
  }
  if (status === 'suspended') where.suspendedAt = { not: null };
  if (status === 'active') where.suspendedAt = null;
  if (locationId) where.profile = { is: { locationId } };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, include: { profile: { include: { location: true } } } }),
  ]);

  const sessionIds = users.map((u: any) => u.profile?.sessionId).filter(Boolean) as string[];
  const counts = sessionIds.length
    ? await prisma.video.groupBy({ by: ['uploaderSessionId'], where: { uploaderSessionId: { in: sessionIds } }, _count: { _all: true } })
    : [];
  const countBySession = new Map<string, number>(counts.map((c: any) => [c.uploaderSessionId as string, c._count._all as number]));

  res.json({
    users: users.map((u: any) => serialize(u, u.profile ? countBySession.get(u.profile.sessionId) || 0 : 0)),
    ...pageMeta(page, limit, total),
  });
});

// GET /api/admin/users/:id — detail with activity counts and recent videos
router.get('/:id', requirePermission('users.view'), async (req: AuthedRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, include: { profile: { include: { location: true } } } });
  if (!user) throw new HttpError(404, 'User not found');

  const sessionId = (user as any).profile?.sessionId as string | undefined;
  let videos: any[] = [];
  let videoCount = 0;
  let commentCount = 0;
  let followers = 0;
  let following = 0;
  if (sessionId) {
    [videos, videoCount, commentCount, followers, following] = await Promise.all([
      prisma.video.findMany({ where: { uploaderSessionId: sessionId }, orderBy: { createdAt: 'desc' }, take: 8 }),
      prisma.video.count({ where: { uploaderSessionId: sessionId } }),
      prisma.comment.count({ where: { sessionId } }),
      prisma.follow.count({ where: { followingSessionId: sessionId } }),
      prisma.follow.count({ where: { followerSessionId: sessionId } }),
    ]);
  }
  res.json({
    user: {
      ...serialize(user, videoCount),
      commentCount,
      followers,
      following,
      recentVideos: videos.map((v) => ({
        id: v.id,
        title: v.title,
        poster: v.posterFilename ? resolveAssetUrl(v.posterFilename, 'posters') : null,
        views: v.views,
        likes: v.likes,
        createdAt: v.createdAt,
      })),
    },
  });
});

// POST /api/admin/users  { email, password, displayName?, handle?, bio?, locationId? }
router.post('/', requirePermission('users.create'), async (req: AuthedRequest, res: Response) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const displayName = String(req.body.displayName || '').trim().slice(0, 40) || null;
  const handle = String(req.body.handle || '').trim().toLowerCase();
  const bio = String(req.body.bio || '').trim().slice(0, 160) || null;
  const locationId = optionalId(req.body.locationId) ?? null;

  if (!isValidEmail(email)) throw new HttpError(400, 'A valid email is required');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (handle && !HANDLE_PATTERN.test(handle)) throw new HttpError(400, 'Handle must be 3–30 characters: lowercase letters, numbers and hyphens');
  if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, 'An account with that email already exists');

  const sessionId = randomUUID();
  const passwordHash = await hashPassword(password);
  let userId: string;
  try {
    userId = await prisma.$transaction(async (tx: any) => {
      const user = await tx.user.create({ data: { email, passwordHash } });
      await tx.sessionProfile.create({
        data: { sessionId, userId: user.id, displayName, bio, locationId, ...(handle ? { handle } : {}) },
      });
      return user.id as string;
    });
  } catch (err: any) {
    if (err?.code === 'P2002') throw new HttpError(409, 'That email or handle is already taken');
    if (err?.code === 'P2003') throw new HttpError(400, 'That location does not exist');
    throw err;
  }
  if (!handle) await ensureHandle(sessionId);

  const created = await prisma.user.findUnique({ where: { id: userId }, include: { profile: { include: { location: true } } } });
  audit(req, 'user.create', 'user', userId, email);
  res.status(201).json({ user: serialize(created, 0) });
});

// PATCH /api/admin/users/:id  { email?, password?, displayName?, handle?, bio?, locationId? }
router.patch('/:id', requirePermission('users.edit'), async (req: AuthedRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, include: { profile: true } });
  if (!user) throw new HttpError(404, 'User not found');
  const body = req.body || {};

  const userData: { email?: string; passwordHash?: string } = {};
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (!isValidEmail(email)) throw new HttpError(400, 'A valid email is required');
    userData.email = email;
  }
  if (body.password) {
    if (String(body.password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    userData.passwordHash = await hashPassword(String(body.password));
  }

  const profileData: Record<string, unknown> = {};
  if (body.displayName !== undefined) profileData.displayName = String(body.displayName).trim().slice(0, 40) || null;
  if (body.bio !== undefined) profileData.bio = String(body.bio).trim().slice(0, 160) || null;
  if (body.handle !== undefined) {
    const handle = String(body.handle).trim().toLowerCase();
    if (!HANDLE_PATTERN.test(handle)) throw new HttpError(400, 'Handle must be 3–30 characters: lowercase letters, numbers and hyphens');
    profileData.handle = handle;
  }
  const locationId = optionalId(body.locationId);
  if (locationId !== undefined) profileData.locationId = locationId;

  try {
    await prisma.$transaction(async (tx: any) => {
      if (Object.keys(userData).length) await tx.user.update({ where: { id: user.id }, data: userData });
      if (Object.keys(profileData).length) {
        const existing = (user as any).profile;
        if (existing) await tx.sessionProfile.update({ where: { id: existing.id }, data: profileData });
        else await tx.sessionProfile.create({ data: { sessionId: randomUUID(), userId: user.id, ...profileData } });
      }
    });
  } catch (err: any) {
    if (err?.code === 'P2002') throw new HttpError(409, 'That email or handle is already taken');
    if (err?.code === 'P2003') throw new HttpError(400, 'That location does not exist');
    throw err;
  }

  const updated = await prisma.user.findUnique({ where: { id: user.id }, include: { profile: { include: { location: true } } } });
  const changed = [...Object.keys(userData).map((k) => (k === 'passwordHash' ? 'password' : k)), ...Object.keys(profileData)].join(', ');
  audit(req, 'user.update', 'user', user.id, changed);
  res.json({ user: serialize(updated) });
});

// POST /api/admin/users/:id/suspend  { reason? }  /  /unsuspend
router.post('/:id/suspend', requirePermission('users.edit'), async (req: AuthedRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) throw new HttpError(404, 'User not found');
  await prisma.user.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });
  audit(req, 'user.suspend', 'user', user.id, String(req.body?.reason || '').slice(0, 200) || user.email);
  res.status(204).send();
});

router.post('/:id/unsuspend', requirePermission('users.edit'), async (req: AuthedRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) throw new HttpError(404, 'User not found');
  await prisma.user.update({ where: { id: user.id }, data: { suspendedAt: null } });
  audit(req, 'user.unsuspend', 'user', user.id, user.email);
  res.status(204).send();
});

// DELETE /api/admin/users/:id?deleteContent=true
// Without deleteContent the account is removed but its videos/comments stay
// (still shown under the old handle). With it, the user's videos (and their
// stored files), comments, follows, notifications and profile go too.
router.delete('/:id', requirePermission('users.delete'), async (req: AuthedRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, include: { profile: true } });
  if (!user) throw new HttpError(404, 'User not found');
  const deleteContent = String(req.query.deleteContent || '') === 'true';
  const profile = (user as any).profile as { id: string; sessionId: string; avatar: string | null } | null;

  if (deleteContent && profile) {
    const sessionId = profile.sessionId;
    const videos = await prisma.video.findMany({ where: { uploaderSessionId: sessionId } });
    for (const v of videos as any[]) {
      await prisma.video.delete({ where: { id: v.id } });
      await removeStoredFile(v.filename, VIDEOS_DIR).catch(() => {});
      if (v.posterFilename) await removeStoredFile(v.posterFilename, POSTERS_DIR).catch(() => {});
    }
    const theirComments = await prisma.comment.findMany({ where: { sessionId }, select: { videoId: true } });
    await prisma.comment.deleteMany({ where: { sessionId } });
    await recountComments(theirComments.map((c: any) => c.videoId));
    await prisma.$transaction([
      prisma.userVideoState.deleteMany({ where: { sessionId } }),
      prisma.follow.deleteMany({ where: { OR: [{ followerSessionId: sessionId }, { followingSessionId: sessionId }] } }),
      prisma.notification.deleteMany({ where: { OR: [{ recipientSessionId: sessionId }, { actorSessionId: sessionId }] } }),
    ]);
    if (profile.avatar) await removeAvatarFile(profile.avatar).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.sessionProfile.delete({ where: { id: profile.id } });
  } else {
    await prisma.user.delete({ where: { id: user.id } }); // profile.userId → NULL (FK SET NULL)
  }

  audit(req, 'user.delete', 'user', user.id, `${user.email}${deleteContent ? ' (with content)' : ''}`);
  res.status(204).send();
});

export default router;
