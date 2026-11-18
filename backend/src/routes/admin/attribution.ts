import { Router, Response } from 'express';
import { prisma } from '../../db';
import { AuthedRequest, requirePermission } from '../../middleware/requireAdmin';
import { HttpError } from '../../lib/httpError';
import { audit } from '../../lib/audit';
import { canTransition, isConversionStatus, sumByCurrency } from '../../lib/attribution';
import { attributionStats } from '../../lib/attributionStats';

const router = Router();

// GET /api/admin/attribution/overview?days=30&siteId=
router.get('/overview', requirePermission('attribution.view'), async (req: AuthedRequest, res: Response) => {
  const days = Math.max(1, Math.min(365, Math.trunc(Number(req.query.days)) || 30));
  const siteId = typeof req.query.siteId === 'string' && req.query.siteId ? req.query.siteId : undefined;
  const [stats, owed] = await Promise.all([
    attributionStats(siteId, new Date(Date.now() - days * 24 * 60 * 60 * 1000)),
    prisma.conversion.findMany({ where: siteId ? { siteId } : {}, select: { currency: true, status: true, commissionMinor: true } }),
  ]);
  res.json({ days, ...stats, ledger: sumByCurrency(owed) });
});

// GET /api/admin/attribution/conversions?status=&siteId=&page=1
router.get('/conversions', requirePermission('attribution.view'), async (req: AuthedRequest, res: Response) => {
  const page = Math.max(1, Math.trunc(Number(req.query.page)) || 1);
  const pageSize = 50;
  const where: Record<string, unknown> = {};
  if (isConversionStatus(req.query.status)) where.status = req.query.status;
  if (typeof req.query.siteId === 'string' && req.query.siteId) where.siteId = req.query.siteId;
  const [total, rows] = await Promise.all([
    prisma.conversion.count({ where }),
    prisma.conversion.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  const videoIds = [...new Set((rows as Array<{ videoId: string }>).map((r) => r.videoId))];
  const siteIds = [...new Set((rows as Array<{ siteId: string }>).map((r) => r.siteId))];
  const sessionIds = [...new Set((rows as Array<{ creatorSessionId: string | null }>).map((r) => r.creatorSessionId).filter((x): x is string => !!x))];
  const [videos, sites, profiles] = await Promise.all([
    videoIds.length ? prisma.video.findMany({ where: { id: { in: videoIds } }, select: { id: true, title: true } }) : [],
    siteIds.length ? prisma.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, name: true } }) : [],
    sessionIds.length ? prisma.sessionProfile.findMany({ where: { sessionId: { in: sessionIds } }, select: { sessionId: true, handle: true, displayName: true, user: { select: { email: true } } } }) : [],
  ]);
  const vt = new Map<string, string>((videos as Array<{ id: string; title: string }>).map((v) => [v.id, v.title]));
  const sn = new Map<string, string>((sites as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]));
  const pr = new Map<string, { handle: string | null; displayName: string | null; user: { email: string } | null }>((profiles as any[]).map((p) => [p.sessionId, p]));
  res.json({
    total,
    page,
    pageSize,
    conversions: (rows as any[]).map((r) => {
      const p = r.creatorSessionId ? pr.get(r.creatorSessionId) : undefined;
      return {
        id: r.id,
        videoId: r.videoId,
        video: vt.get(r.videoId) ?? '(deleted video)',
        site: sn.get(r.siteId) ?? '(removed site)',
        creator: p?.displayName || (p?.handle ? `@${p.handle}` : '—'),
        creatorEmail: p?.user?.email ?? null,
        externalOrderId: r.externalOrderId,
        currency: r.currency,
        amountMinor: r.amountMinor,
        commissionMinor: r.commissionMinor,
        status: r.status,
        createdAt: r.createdAt,
      };
    }),
  });
});

// PATCH /api/admin/attribution/conversions/:id { status } — approve / mark paid / reverse.
router.patch('/conversions/:id', requirePermission('attribution.edit'), async (req: AuthedRequest, res: Response) => {
  const to = req.body?.status;
  if (!isConversionStatus(to)) throw new HttpError(400, 'status must be approved, paid or reversed');
  const row = await prisma.conversion.findUnique({ where: { id: req.params.id } });
  if (!row) throw new HttpError(404, 'Entry not found');
  if (!canTransition(row.status, to)) throw new HttpError(409, `An entry that is ${row.status} can't become ${to}`);
  // Conditional on the current status so two admins can't both move the same entry.
  const r = await prisma.conversion.updateMany({ where: { id: row.id, status: row.status }, data: { status: to } });
  if (r.count === 0) throw new HttpError(409, 'That entry was just changed by someone else — reload and try again');
  audit(req, `payout.${to}`, 'conversion', row.id, `${row.externalOrderId}: ${row.status} → ${to} (${row.commissionMinor} ${row.currency})`);
  res.json({ id: row.id, status: to });
});

export default router;
