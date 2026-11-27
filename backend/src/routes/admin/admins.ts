import { Router, Response } from 'express';
import { prisma } from '../../db';
import { AuthedRequest, requirePrimary } from '../../middleware/requireAdmin';
import { HttpError } from '../../lib/core/httpError';
import { hashPassword } from '../../lib/core/auth';
import { normalizePermissions } from '../../lib/core/permissions';
import { audit } from '../../lib/core/audit';

/**
 * Admin management — PRIMARY admin only.
 *
 * The primary admin creates secondary admins and picks exactly which
 * permissions each gets. The primary account itself can't be edited, disabled
 * or deleted through this API (there is only ever one, and it always has full
 * control).
 */
const router = Router();
router.use(requirePrimary);

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function serialize(a: any, creators?: Map<string, string>) {
  return {
    id: a.id,
    email: a.email,
    name: a.name,
    role: a.role,
    permissions: a.permissions,
    disabled: a.disabled,
    lastLoginAt: a.lastLoginAt,
    createdAt: a.createdAt,
    createdBy: a.createdById ? creators?.get(a.createdById) ?? null : null,
  };
}

// GET /api/admin/admins
router.get('/', async (_req: AuthedRequest, res: Response) => {
  const admins = await prisma.adminUser.findMany({ orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] });
  const creators = new Map<string, string>(admins.map((a: any) => [a.id as string, a.email as string]));
  res.json({ admins: admins.map((a: any) => serialize(a, creators)) });
});

// POST /api/admin/admins  { email, name?, password, permissions[] }
router.post('/', async (req: AuthedRequest, res: Response) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim().slice(0, 80);
  const password = String(req.body.password || '');
  if (!isValidEmail(email)) throw new HttpError(400, 'A valid email is required');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (await prisma.adminUser.findUnique({ where: { email } })) throw new HttpError(409, 'An admin with that email already exists');

  const admin = await prisma.adminUser.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(password),
      role: 'SECONDARY',
      permissions: normalizePermissions(req.body.permissions),
      createdById: req.admin!.id,
    },
  });
  audit(req, 'admin.create', 'admin', admin.id, email);
  res.status(201).json({ admin: serialize(admin) });
});

async function loadSecondary(id: string) {
  const target = await prisma.adminUser.findUnique({ where: { id } });
  if (!target) throw new HttpError(404, 'Admin not found');
  if (target.role === 'PRIMARY') throw new HttpError(403, 'The primary admin cannot be modified here');
  return target;
}

// PATCH /api/admin/admins/:id  { name?, email?, password?, permissions?, disabled? }
router.patch('/:id', async (req: AuthedRequest, res: Response) => {
  const target = await loadSecondary(req.params.id);
  const body = req.body || {};
  const data: Record<string, unknown> = {};

  if (body.name !== undefined) data.name = String(body.name).trim().slice(0, 80);
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (!isValidEmail(email)) throw new HttpError(400, 'A valid email is required');
    data.email = email;
  }
  if (body.password) {
    if (String(body.password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    data.passwordHash = await hashPassword(String(body.password));
  }
  if (body.permissions !== undefined) data.permissions = normalizePermissions(body.permissions);
  if (body.disabled !== undefined) data.disabled = !!body.disabled;

  try {
    const updated = await prisma.adminUser.update({ where: { id: target.id }, data });
    const changed = Object.keys(data).map((k) => (k === 'passwordHash' ? 'password' : k)).join(', ');
    audit(req, 'admin.update', 'admin', target.id, `${target.email}: ${changed}`);
    res.json({ admin: serialize(updated) });
  } catch (err: any) {
    if (err?.code === 'P2002') throw new HttpError(409, 'An admin with that email already exists');
    throw err;
  }
});

// DELETE /api/admin/admins/:id
router.delete('/:id', async (req: AuthedRequest, res: Response) => {
  const target = await loadSecondary(req.params.id);
  await prisma.adminUser.delete({ where: { id: target.id } });
  audit(req, 'admin.delete', 'admin', target.id, target.email);
  res.status(204).send();
});

export default router;
