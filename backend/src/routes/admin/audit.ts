import { Router, Response } from 'express';
import { prisma } from '../../db';
import { AuthedRequest, requirePrimary } from '../../middleware/requireAdmin';
import { parsePage, pageMeta } from '../../lib/pagination';

const router = Router();
router.use(requirePrimary);

// GET /api/admin/audit?q=&page=&limit=
router.get('/', async (req: AuthedRequest, res: Response) => {
  const { page, limit, skip, take } = parsePage(req, 30);
  const q = String(req.query.q || '').trim();
  const where: any = q
    ? {
        OR: [
          { adminEmail: { contains: q, mode: 'insensitive' } },
          { action: { contains: q, mode: 'insensitive' } },
          { detail: { contains: q, mode: 'insensitive' } },
        ],
      }
    : {};
  const [total, entries] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
  ]);
  res.json({ entries, ...pageMeta(page, limit, total) });
});

export default router;
