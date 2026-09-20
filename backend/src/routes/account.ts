import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { hashPassword, verifyPassword } from '../lib/auth';
import { HttpError } from '../lib/httpError';
import { ensureHandle, resolveAvatarUrl } from './profile';
import { authLimiter } from '../middleware/rateLimit';

const router = Router();

function getSessionId(req: Request): string {
  const id = req.header('x-session-id');
  if (!id || !id.trim()) throw new HttpError(400, 'Missing X-Session-Id header');
  return id.trim();
}

function getSessionIdOptional(req: Request): string | null {
  const id = req.header('x-session-id');
  return id && id.trim() ? id.trim() : null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * A marketplace checkout login (see routes/marketplace.ts's
 * MarketplaceLink) is saved against whatever sessionId was active on
 * that browser at the time — but logging into a Videos account can
 * swap the browser onto a DIFFERENT (canonical) sessionId (see login,
 * below). Without this, a viewer who was already linked to checkout,
 * then logged into their Videos account from that same browser, would
 * silently lose that marketplace link — stranded on the now-abandoned
 * session — and be asked to log into checkout again for no reason
 * they'd understand. Only moves it when the canonical session doesn't
 * already have its own marketplace link, since that one is the
 * account's real, established link and shouldn't be overwritten by
 * whatever an unrelated browser happened to be doing.
 */
async function migrateMarketplaceLink(fromSessionId: string, toSessionId: string): Promise<void> {
  const [fromLink, toLink] = await Promise.all([
    prisma.marketplaceLink.findUnique({ where: { sessionId: fromSessionId } }),
    prisma.marketplaceLink.findUnique({ where: { sessionId: toSessionId } }),
  ]);
  if (!fromLink || toLink) return; // nothing to move, or the canonical session already has its own
  await prisma.marketplaceLink.update({ where: { sessionId: fromSessionId }, data: { sessionId: toSessionId } });
}

function serializeAccount(profile: { handle: string | null; displayName: string | null; avatar: string | null; bio: string | null }, email: string) {
  return {
    email,
    handle: profile.handle,
    displayName: profile.displayName,
    avatar: profile.avatar ? resolveAvatarUrl(profile.avatar) : null,
    bio: profile.bio,
  };
}

// POST /api/account/signup  { email, password }
//
// Turns the CURRENT browser session's anonymous identity (its videos,
// likes, and handle — all keyed by X-Session-Id) into a real, recoverable
// account. Deliberately does NOT introduce a separate auth token: every
// other route keeps working exactly as before, reading the same
// X-Session-Id it always has. What login (below) adds is a way to get
// THAT SAME sessionId back on a different device/browser.
router.post('/signup', authLimiter, async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!isValidEmail(email)) throw new HttpError(400, 'A valid email is required');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new HttpError(409, 'An account with that email already exists — log in instead');

  // A session that already has a handle (i.e. has uploaded before)
  // keeps it; a brand-new session gets one now, same as first upload —
  // either way, signing up should never leave the account without one.
  await ensureHandle(sessionId);

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({ data: { email, passwordHash } });

  const profile = await prisma.sessionProfile.update({
    where: { sessionId },
    data: { userId: user.id },
  });

  res.status(201).json({ sessionId, ...serializeAccount(profile, email) });
});

// POST /api/account/login  { email, password }
//
// Returns the CANONICAL sessionId for this account — the one from the
// device/browser it was created or last logged in from — not the
// current device's. The frontend adopts it as its own X-Session-Id
// afterwards (see api.ts's setSessionId), which is what actually
// restores access to that identity's videos/handle on a new device:
// every other route is unchanged and just keeps trusting whatever
// X-Session-Id it's sent.
router.post('/login', authLimiter, async (req: Request, res: Response) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new HttpError(401, 'Invalid email or password');
  }

  const profile = await prisma.sessionProfile.findUnique({ where: { userId: user.id } });
  if (!profile) {
    // Shouldn't happen (signup always creates one) — but rather than
    // 500 on an inconsistent row, bind this login's current session as
    // the canonical one so the account is still usable.
    const sessionId = getSessionId(req);
    const created = await prisma.sessionProfile.upsert({
      where: { sessionId },
      update: { userId: user.id },
      create: { sessionId, userId: user.id },
    });
    res.json({ sessionId, ...serializeAccount(created, email) });
    return;
  }

  const currentSessionId = getSessionIdOptional(req);
  if (currentSessionId && currentSessionId !== profile.sessionId) {
    await migrateMarketplaceLink(currentSessionId, profile.sessionId);
  }

  res.json({ sessionId: profile.sessionId, ...serializeAccount(profile, email) });
});

export default router;
