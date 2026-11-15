import { Request, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { HttpError } from '../lib/httpError';

/**
 * Guards every write (like, comment, follow, upload, profile edits…).
 *
 * Reading is open: anyone — including a signed-out guest with a fresh
 * anonymous X-Session-Id — can browse and watch. But a write must come
 * from a session that is linked to a real account (SessionProfile.userId,
 * set by signup/login in routes/account.ts). This is the server-side
 * counterpart of the apps' "sign in to like / comment / upload" popups,
 * so the rule holds even for a client that skips the popup.
 *
 * Clients can branch on `code: 'SIGN_IN_REQUIRED'` (HTTP 401).
 */
export async function requireAccount(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const sessionId = req.header('x-session-id')?.trim();
  if (!sessionId) throw new HttpError(400, 'Missing X-Session-Id header');

  const profile = await prisma.sessionProfile.findUnique({ where: { sessionId }, select: { userId: true } });
  if (!profile?.userId) {
    throw new HttpError(401, 'Sign in to continue', { code: 'SIGN_IN_REQUIRED' });
  }
  next();
}
