import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { HttpError } from '../lib/httpError';
import * as marketplace from '../lib/marketplace';

const router = Router();

/**
 * Every route here is scoped to the anonymous browser session (the
 * same X-Session-Id header used by /api/videos for likes/favorites/
 * saves — see routes/videos.ts). A marketplace login is stored against
 * that session id, so "is this viewer already linked?" can be answered
 * without asking them to log in again on every video.
 */
function getSessionId(req: Request): string {
  const id = req.header('x-session-id');
  if (!id || !id.trim()) throw new HttpError(400, 'Missing X-Session-Id header');
  return id.trim();
}

async function saveLink(sessionId: string, token: string, userId: string) {
  await prisma.marketplaceLink.upsert({
    where: { sessionId },
    update: { marketplaceToken: token, marketplaceUserId: userId },
    create: { sessionId, marketplaceToken: token, marketplaceUserId: userId },
  });
}

// GET /api/marketplace/account — is this session already linked to a marketplace account?
router.get('/account', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const link = await prisma.marketplaceLink.findUnique({ where: { sessionId } });
  res.json({ linked: Boolean(link) });
});

// POST /api/marketplace/login  { email, password }
router.post('/login', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    throw new HttpError(400, 'Email and password are required');
  }

  const result = await marketplace.login(email.trim(), password);
  await saveLink(sessionId, result.token, result.userId);
  res.json({ linked: true });
});

// POST /api/marketplace/register  { email, password, name? }
router.post('/register', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const { email, password, name } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    throw new HttpError(400, 'Email and password are required');
  }

  const result = await marketplace.register(email.trim(), password, typeof name === 'string' ? name.trim() : undefined);
  await saveLink(sessionId, result.token, result.userId);
  res.json({ linked: true });
});

// DELETE /api/marketplace/account — unlink (log out of the marketplace on this device)
router.delete('/account', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  await prisma.marketplaceLink.deleteMany({ where: { sessionId } });
  res.status(204).end();
});

// POST /api/marketplace/checkout  { items: [{ productId, quantity }] }
// Requires an already-linked marketplace account for this session — the
// frontend is expected to prompt login/register first (see /account)
// and only call this once `linked` is true.
router.post('/checkout', async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'At least one item is required');
  }
  for (const item of items) {
    if (!item || typeof item.productId !== 'string' || !item.productId) {
      throw new HttpError(400, 'Each item requires a productId');
    }
    if (typeof item.quantity !== 'number' || item.quantity < 1) {
      throw new HttpError(400, 'Each item requires a quantity of at least 1');
    }
  }

  const link = await prisma.marketplaceLink.findUnique({ where: { sessionId } });
  if (!link) {
    throw new HttpError(401, 'No marketplace account is linked for this session');
  }

  const result = await marketplace.checkout(
    link.marketplaceToken,
    items.map((i: { productId: string; quantity: number }) => ({ productId: i.productId, quantity: i.quantity }))
  );
  res.json(result);
});

export default router;
