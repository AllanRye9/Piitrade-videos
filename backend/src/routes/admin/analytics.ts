import { Router, Response } from 'express';
import { prisma } from '../../db';
import { AuthedRequest } from '../../middleware/requireAdmin';

/**
 * GET /api/admin/analytics?days=30 — daily time series, top lists and the partner funnel for the dashboard.
 * Like /stats, each section is included only if the admin may view that resource.
 */
const router = Router();

interface Point {
  day: string;
  value: number;
}

const DAY = 24 * 60 * 60 * 1000;
const key = (d: Date) => d.toISOString().slice(0, 10);

/** Fills every UTC day in [start, today] so charts have no gaps. */
function fill(rows: Array<{ day: Date | string; n: number | bigint }>, start: Date, days: number): Point[] {
  const m = new Map(rows.map((r) => [key(new Date(r.day)), Number(r.n)]));
  return Array.from({ length: days }, (_, i) => {
    const day = key(new Date(start.getTime() + i * DAY));
    return { day, value: m.get(day) ?? 0 };
  });
}

router.get('/', async (req: AuthedRequest, res: Response) => {
  const can = (p: string) => req.admin!.permissions.includes(p);
  const days = Math.min(90, Math.max(7, Math.round(Number(req.query.days) || 30)));
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const start = new Date(today.getTime() - (days - 1) * DAY);
  const prevStart = new Date(start.getTime() - days * DAY);
  const out: Record<string, unknown> = { days };
  const jobs: Promise<void>[] = [];

  // Daily counts of rows created, for one table. Table names are fixed literals below, never user input.
  const daily = (table: 'User' | 'Video' | 'Comment' | 'Click' | 'Conversion') =>
    prisma.$queryRawUnsafe(
      `SELECT date_trunc('day', "createdAt")::date AS day, count(*)::int AS n FROM "${table}" WHERE "createdAt" >= $1 GROUP BY 1`,
      start
    ) as Promise<Array<{ day: Date; n: number }>>;
  const total = (rows: Point[]) => rows.reduce((a, p) => a + p.value, 0);

  if (can('users.view')) {
    jobs.push(
      Promise.all([daily('User'), prisma.user.count({ where: { createdAt: { gte: prevStart, lt: start } } })]).then(([rows, prev]) => {
        const series = fill(rows, start, days);
        out.signups = { series, total: total(series), previous: prev };
      })
    );
  }
  if (can('videos.view')) {
    jobs.push(
      Promise.all([
        daily('Video'),
        prisma.video.count({ where: { createdAt: { gte: prevStart, lt: start } } }),
        prisma.video.findMany({ orderBy: { views: 'desc' }, take: 8, select: { id: true, title: true, views: true, likes: true, shares: true } }),
      ]).then(([rows, prev, top]) => {
        const series = fill(rows, start, days);
        out.uploads = { series, total: total(series), previous: prev };
        out.topVideos = top;
      })
    );
  }
  if (can('comments.view')) {
    jobs.push(
      Promise.all([daily('Comment'), prisma.comment.count({ where: { createdAt: { gte: prevStart, lt: start } } })]).then(([rows, prev]) => {
        const series = fill(rows, start, days);
        out.comments = { series, total: total(series), previous: prev };
      })
    );
  }
  if (can('attribution.view')) {
    jobs.push(
      Promise.all([
        daily('Click'),
        daily('Conversion'),
        prisma.click.count({ where: { createdAt: { gte: prevStart, lt: start } } }),
        prisma.conversion.count({ where: { createdAt: { gte: prevStart, lt: start } } }),
        prisma.click.groupBy({ by: ['siteId'], where: { createdAt: { gte: start } }, _count: { _all: true }, orderBy: { _count: { siteId: 'desc' } }, take: 6 }),
        prisma.siteDailyStat.aggregate({ where: { day: { gte: start } }, _sum: { impressions: true } }),
        prisma.savedItem.count({ where: { createdAt: { gte: start } } }),
        prisma.site.findMany({ select: { id: true, name: true } }),
      ]).then(([clickRows, convRows, prevClicks, prevConv, bySite, imp, saves, sites]) => {
        const clicks = fill(clickRows, start, days);
        const conversions = fill(convRows, start, days);
        out.clicks = { series: clicks, total: total(clicks), previous: prevClicks };
        out.conversions = { series: conversions, total: total(conversions), previous: prevConv };
        const names = new Map<string, string>(sites.map((s: { id: string; name: string }) => [s.id, s.name]));
        out.topShops = bySite.map((r: { siteId: string; _count: { _all: number } }) => ({ siteId: r.siteId, name: names.get(r.siteId) ?? 'Unknown', clicks: r._count._all }));
        // The partner funnel: tags shown → saved → clicked → sold.
        out.funnel = { impressions: imp._sum.impressions ?? 0, saves, clicks: total(clicks), conversions: total(conversions) };
      })
    );
  }
  if (can('sites.view')) {
    jobs.push(
      Promise.all([
        prisma.partnerApplication.count({ where: { status: 'pending' } }),
        prisma.site.count({ where: { active: true } }),
        prisma.site.count(),
      ]).then(([pending, active, all]) => {
        out.partners = { pendingApplications: pending, activeShops: active, totalShops: all };
      })
    );
  }
  await Promise.all(jobs);
  res.json(out);
});

export default router;
