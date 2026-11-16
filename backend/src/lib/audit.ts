import { prisma } from '../db';
import type { AuthedRequest } from '../middleware/requireAdmin';

/** Records an admin action. Never throws — auditing must not break the action itself. */
export function audit(req: AuthedRequest, action: string, targetType: string, targetId?: string | null, detail?: string): void {
  const admin = req.admin;
  if (!admin) return;
  prisma.auditLog
    .create({
      data: {
        adminId: admin.id,
        adminEmail: admin.email,
        action,
        targetType,
        targetId: targetId ?? null,
        detail: detail ? detail.slice(0, 500) : null,
      },
    })
    .catch((err: unknown) => console.error('audit log write failed', err));
}
