import { Request, Response, NextFunction } from 'express';
import { verifyAdminToken } from '../lib/core/auth';
import { prisma } from '../db';
import { ALL_PERMISSIONS } from '../lib/core/permissions';

export interface CurrentAdmin {
  id: string;
  email: string;
  name: string;
  role: 'PRIMARY' | 'SECONDARY';
  /** Effective permissions — the full catalogue for the primary admin. */
  permissions: string[];
}

export interface AuthedRequest extends Request {
  admin?: CurrentAdmin;
}

export function toCurrentAdmin(a: { id: string; email: string; name: string; role: string; permissions: string[] }): CurrentAdmin {
  const primary = a.role === 'PRIMARY';
  return {
    id: a.id,
    email: a.email,
    name: a.name,
    role: primary ? 'PRIMARY' : 'SECONDARY',
    permissions: primary ? ALL_PERMISSIONS : a.permissions,
  };
}

/** Verifies the bearer token, then loads the admin fresh from the database so
 *  a disabled/deleted admin or a changed permission set applies immediately. */
export async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.header('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  let sub: string;
  try {
    sub = verifyAdminToken(token).sub;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  const admin = await prisma.adminUser.findUnique({ where: { id: sub } });
  if (!admin) {
    res.status(401).json({ error: 'This admin account no longer exists' });
    return;
  }
  if (admin.disabled) {
    res.status(403).json({ error: 'This admin account has been disabled' });
    return;
  }
  req.admin = toCurrentAdmin(admin);
  next();
}

/** Route guard: the admin must hold `permission` (the primary always does). */
export function requirePermission(permission: string) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.admin?.permissions.includes(permission)) {
      res.status(403).json({ error: `You don't have permission to do that (${permission})` });
      return;
    }
    next();
  };
}

/** Route guard: only the primary admin (admin management, audit log). */
export function requirePrimary(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.admin?.role !== 'PRIMARY') {
    res.status(403).json({ error: 'Only the primary admin can do that' });
    return;
  }
  next();
}
