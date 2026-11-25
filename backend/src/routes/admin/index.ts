import { Router, Response } from 'express';
import { prisma } from '../../db';
import { requireAdmin, AuthedRequest } from '../../middleware/requireAdmin';
import { RESOURCES } from '../../lib/permissions';
import usersRouter from './users';
import videosRouter from './videos';
import commentsRouter from './comments';
import reportsRouter from './reports';
import productsRouter from './products';
import locationsRouter from './locations';
import adminsRouter from './admins';
import auditRouter from './audit';
import sitesRouter from './sites';
import partnerApplicationsRouter from './partnerApplications';
import attributionAdminRouter from './attribution';
import settingsRouter from './settings';
import analyticsRouter from './analytics';
import systemRouter from './system';

/**
 * Everything under /api/admin. Every request is authenticated by requireAdmin
 * (which re-loads the admin from the DB) and each route then declares the
 * permission it needs — see lib/permissions.ts. Admin management and the audit
 * log are primary-admin only.
 */
const router = Router();
router.use(requireAdmin);

// GET /api/admin/permissions — the catalogue the "create admin" form renders.
router.get('/permissions', (_req, res: Response) => {
  res.json({ resources: RESOURCES });
});

// GET /api/admin/stats — only counts for resources this admin may view.
router.get('/stats', async (req: AuthedRequest, res: Response) => {
  const can = (p: string) => req.admin!.permissions.includes(p);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const out: Record<string, unknown> = {};
  const jobs: Promise<void>[] = [];

  if (can('users.view')) {
    jobs.push(
      Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { suspendedAt: { not: null } } }),
        prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      ]).then(([total, suspended, newThisWeek]) => {
        out.users = { total, suspended, newThisWeek };
      })
    );
  }
  if (can('videos.view')) {
    jobs.push(
      Promise.all([
        prisma.video.count(),
        prisma.video.count({ where: { createdAt: { gte: weekAgo } } }),
        prisma.video.aggregate({ _sum: { views: true, likes: true, shares: true } }),
        prisma.video.findMany({ orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, title: true, views: true, likes: true, createdAt: true } }),
      ]).then(([total, newThisWeek, sums, recent]) => {
        out.videos = {
          total,
          newThisWeek,
          totalViews: sums._sum.views || 0,
          totalLikes: sums._sum.likes || 0,
          totalShares: sums._sum.shares || 0,
          recent,
        };
      })
    );
  }
  if (can('comments.view')) {
    jobs.push(prisma.comment.count().then((n: number) => void (out.comments = { total: n })));
  }
  if (can('reports.view')) {
    jobs.push(
      prisma.report.groupBy({ by: ['videoId'] }).then((rows: unknown[]) => void (out.reports = { openVideos: rows.length }))
    );
  }
  if (can('products.view')) {
    jobs.push(prisma.product.count().then((n: number) => void (out.products = { total: n })));
  }
  if (can('locations.view')) {
    jobs.push(prisma.location.count().then((n: number) => void (out.locations = { total: n })));
  }
  if (req.admin!.role === 'PRIMARY') {
    jobs.push(prisma.adminUser.count().then((n: number) => void (out.admins = { total: n })));
  }

  await Promise.all(jobs);
  res.json(out);
});

router.use('/users', usersRouter);
router.use('/videos', videosRouter);
router.use('/comments', commentsRouter);
router.use('/reports', reportsRouter);
router.use('/products', productsRouter);
router.use('/locations', locationsRouter);
router.use('/admins', adminsRouter);
router.use('/audit', auditRouter);
router.use('/sites', sitesRouter);
router.use('/partner-applications', partnerApplicationsRouter);
router.use('/attribution', attributionAdminRouter);
router.use('/settings', settingsRouter);
router.use('/analytics', analyticsRouter);
router.use('/system', systemRouter);

export default router;
