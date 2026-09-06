import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { hashPassword, verifyPassword, signAdminToken } from '../lib/auth';
import { HttpError } from '../lib/httpError';
import { requireAdmin, AuthedRequest } from '../middleware/requireAdmin';

const router = Router();

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// POST /api/auth/register  { email, password, setupCode? }
//
// The very first admin account can always be created (so the dashboard
// is usable out of the box). Every registration after that requires
// ADMIN_SETUP_CODE to be set as an env var and passed as `setupCode`,
// so a public deployment can't have arbitrary admin accounts created
// by anyone who finds the /admin/register page.
router.post('/register', async (req: Request, res: Response) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const setupCode = String(req.body.setupCode || '');

  if (!isValidEmail(email)) throw new HttpError(400, 'A valid email is required');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');

  const existingCount = await prisma.adminUser.count();
  if (existingCount > 0) {
    const required = process.env.ADMIN_SETUP_CODE;
    if (!required || setupCode !== required) {
      throw new HttpError(403, 'A valid setup code is required to register additional admin accounts');
    }
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) throw new HttpError(409, 'An account with that email already exists');

  const passwordHash = await hashPassword(password);
  const admin = await prisma.adminUser.create({ data: { email, passwordHash } });

  const token = signAdminToken({ sub: admin.id, email: admin.email });
  res.status(201).json({ token, admin: { id: admin.id, email: admin.email } });
});

// POST /api/auth/login  { email, password }
router.post('/login', async (req: Request, res: Response) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
    throw new HttpError(401, 'Invalid email or password');
  }

  const token = signAdminToken({ sub: admin.id, email: admin.email });
  res.json({ token, admin: { id: admin.id, email: admin.email } });
});

// GET /api/auth/me
router.get('/me', requireAdmin, async (req: AuthedRequest, res: Response) => {
  res.json({ admin: { id: req.admin!.sub, email: req.admin!.email } });
});

export default router;
