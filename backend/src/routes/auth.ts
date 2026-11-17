import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { hashPassword, verifyPassword, signAdminToken, DUMMY_HASH } from '../lib/auth';
import { HttpError } from '../lib/httpError';
import { requireAdmin, toCurrentAdmin, AuthedRequest } from '../middleware/requireAdmin';
import { authLimiter } from '../middleware/rateLimit';
import { ALL_PERMISSIONS } from '../lib/permissions';

const router = Router();

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// GET /api/auth/setup-status
//
// Tells the admin sign-in page whether the one-time "first admin" registration
// is still open. Once any admin exists, registration is closed for good —
// further admins are created by the primary admin from inside the dashboard.
router.get('/setup-status', async (_req: Request, res: Response) => {
  const count = await prisma.adminUser.count();
  res.json({ needsSetup: count === 0, requiresSetupCode: count === 0 && !!process.env.ADMIN_SETUP_CODE });
});

// POST /api/auth/register  { email, password, name?, setupCode? }
//
// Works exactly once: the first account becomes the PRIMARY admin with full
// control. After that this endpoint is closed (403). If ADMIN_SETUP_CODE is set
// in the environment it is required for that first registration, so nobody can
// claim a freshly deployed instance before its owner does.
router.post('/register', authLimiter, async (req: Request, res: Response) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const name = String(req.body.name || '').trim().slice(0, 80);
  const setupCode = String(req.body.setupCode || '');

  if (!isValidEmail(email)) throw new HttpError(400, 'A valid email is required');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');

  if ((await prisma.adminUser.count()) > 0) {
    throw new HttpError(403, 'Registration is closed. Ask the primary admin to create an account for you.');
  }
  const required = process.env.ADMIN_SETUP_CODE;
  if (required && setupCode !== required) {
    throw new HttpError(403, 'A valid setup code is required');
  }

  const passwordHash = await hashPassword(password);
  let admin;
  try {
    admin = await prisma.adminUser.create({
      data: { email, passwordHash, name, role: 'PRIMARY', permissions: ALL_PERMISSIONS, lastLoginAt: new Date() },
    });
  } catch (err: any) {
    // The DB allows only one PRIMARY row, so a simultaneous second first-registration lands here.
    if (err?.code === 'P2002') throw new HttpError(403, 'Registration is closed. Ask the primary admin to create an account for you.');
    throw err;
  }

  const token = signAdminToken({ sub: admin.id, email: admin.email });
  res.status(201).json({ token, admin: toCurrentAdmin(admin) });
});

// POST /api/auth/login  { email, password }
router.post('/login', authLimiter, async (req: Request, res: Response) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const admin = await prisma.adminUser.findUnique({ where: { email } });
  // Always run a bcrypt comparison so response time doesn't reveal whether the email exists.
  const passwordOk = await verifyPassword(password, admin?.passwordHash ?? DUMMY_HASH);
  if (!admin || !passwordOk) {
    throw new HttpError(401, 'Invalid email or password');
  }
  if (admin.disabled) throw new HttpError(403, 'This admin account has been disabled');

  await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
  const token = signAdminToken({ sub: admin.id, email: admin.email });
  res.json({ token, admin: toCurrentAdmin(admin) });
});

// GET /api/auth/me
router.get('/me', requireAdmin, async (req: AuthedRequest, res: Response) => {
  res.json({ admin: req.admin });
});

// PATCH /api/auth/me  { name }
router.patch('/me', requireAdmin, async (req: AuthedRequest, res: Response) => {
  const name = String(req.body.name ?? '').trim().slice(0, 80);
  const updated = await prisma.adminUser.update({ where: { id: req.admin!.id }, data: { name } });
  res.json({ admin: toCurrentAdmin(updated) });
});

// POST /api/auth/password  { currentPassword, newPassword }
router.post('/password', authLimiter, requireAdmin, async (req: AuthedRequest, res: Response) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 8) throw new HttpError(400, 'New password must be at least 8 characters');

  const admin = await prisma.adminUser.findUnique({ where: { id: req.admin!.id } });
  if (!admin || !(await verifyPassword(currentPassword, admin.passwordHash))) {
    throw new HttpError(401, 'Current password is incorrect');
  }
  await prisma.adminUser.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(newPassword) } });
  res.status(204).send();
});

export default router;
