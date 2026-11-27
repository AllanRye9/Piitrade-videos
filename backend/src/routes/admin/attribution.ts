import { Router, Response } from 'express';
import { prisma } from '../../db';
import { AuthedRequest, requirePermission } from '../../middleware/requireAdmin';
import { HttpError } from '../../lib/core/httpError';
import { audit } from '../../lib/core/audit';
import { canTransition, PAYOUT_STATUSES } from '../../lib/shops/attribution';
import { fromMinor } from '../../lib/core/money';
import { pageMeta, parsePage } from '../../lib/core/pagination';
import { compare, holdoutPct, summarize, utcDay, CohortSums } from '../../lib/feed/guardrail';

const router = Router();

const topN = <T>(m: Map<string, T>, score: (v: T) => number, n = 10): Array<[string, T]> => [...m.entries()].sort((a, b) => score(b[1]) - score(a[1])).slice(0, n);

// GET /api/admin/attribution/overview?days=30&siteId=
router.get('/overview', requirePermission('attribution.view'), async (req: AuthedRequest, res: Response) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const siteId = String(req.query.siteId || '');
  const since = new Date(Date.now() - days * 86_400_000);
  const clickWhere: any = { createdAt: { gte: since }, ...(siteId ? { siteId } : {}) };
  const convWhere: any = { createdAt: { gte: since }, ...(siteId ? { siteId } : {}) };

  const saveWhere: any = { createdAt: { gte: since }, ...(siteId ? { siteId } : {}) };
  const [sites, clicksBySite, convs, clicksByVideo, clicksByCreator, savesBySite] = await Promise.all([
    prisma.site.findMany({ select: { id: true, name: true } }),
    prisma.click.groupBy({ by: ['siteId'], where: clickWhere, _count: { _all: true } }),
    prisma.conversion.findMany({ where: convWhere, select: { siteId: true, amountMinor: true, currency: true, click: { select: { videoId: true, creatorSessionId: true } }, payout: { select: { amountMinor: true, status: true } } }, take: 20000 }),
    prisma.click.groupBy({ by: ['videoId'], where: { ...clickWhere, videoId: { not: null } }, _count: { _all: true }, orderBy: { _count: { videoId: 'desc' } }, take: 50 }),
    prisma.click.groupBy({ by: ['creatorSessionId'], where: { ...clickWhere, creatorSessionId: { not: null } }, _count: { _all: true }, orderBy: { _count: { creatorSessionId: 'desc' } }, take: 50 }),
    prisma.savedItem.groupBy({ by: ['siteId'], where: saveWhere, _count: { _all: true } }),
  ]);

  const siteName = new Map<string, string>(sites.map((s: any) => [s.id as string, s.name as string]));
  const perSite = new Map<string, { site: string; saves: number; clicks: number; conversions: number; revenue: Record<string, number> }>();
  const row = (id: string) => perSite.get(id) ?? perSite.set(id, { site: siteName.get(id) ?? id, saves: 0, clicks: 0, conversions: 0, revenue: {} }).get(id)!;
  for (const c of clicksBySite as any[]) row(c.siteId).clicks = c._count._all;
  let totalSaves = 0;
  for (const sv of savesBySite as any[]) {
    row(sv.siteId).saves = sv._count._all;
    totalSaves += sv._count._all;
  }

  const videoStats = new Map<string, { clicks: number; conversions: number }>();
  const creatorStats = new Map<string, { clicks: number; conversions: number; earned: Record<string, number> }>();
  for (const v of clicksByVideo as any[]) videoStats.set(v.videoId, { clicks: v._count._all, conversions: 0 });
  for (const c of clicksByCreator as any[]) creatorStats.set(c.creatorSessionId, { clicks: c._count._all, conversions: 0, earned: {} });

  const totals = { saves: totalSaves, clicks: 0, conversions: convs.length, revenue: {} as Record<string, number>, credited: {} as Record<string, number> };
  for (const c of clicksBySite as any[]) totals.clicks += c._count._all;
  for (const cv of convs as any[]) {
    const r = row(cv.siteId);
    r.conversions += 1;
    r.revenue[cv.currency] = (r.revenue[cv.currency] || 0) + fromMinor(cv.amountMinor);
    totals.revenue[cv.currency] = (totals.revenue[cv.currency] || 0) + fromMinor(cv.amountMinor);
    const vid = cv.click?.videoId;
    if (vid && videoStats.has(vid)) videoStats.get(vid)!.conversions += 1;
    const cr = cv.click?.creatorSessionId;
    if (cr && creatorStats.has(cr)) {
      const cs = creatorStats.get(cr)!;
      cs.conversions += 1;
      if (cv.payout && cv.payout.status !== 'reversed') cs.earned[cv.currency] = (cs.earned[cv.currency] || 0) + fromMinor(cv.payout.amountMinor);
    }
    if (cv.payout && cv.payout.status !== 'reversed') totals.credited[cv.currency] = (totals.credited[cv.currency] || 0) + fromMinor(cv.payout.amountMinor);
  }

  const topVideoIds = topN(videoStats, (v) => v.conversions * 1000 + v.clicks).map(([id]) => id);
  const topCreatorIds = topN(creatorStats, (v) => v.conversions * 1000 + v.clicks).map(([id]) => id);
  const [videos, profiles] = await Promise.all([
    prisma.video.findMany({ where: { id: { in: topVideoIds } }, select: { id: true, title: true } }),
    prisma.sessionProfile.findMany({ where: { sessionId: { in: topCreatorIds } }, select: { sessionId: true, handle: true } }),
  ]);
  const title = new Map<string, string>(videos.map((v: any) => [v.id as string, v.title as string]));
  const handle = new Map<string, string | null>(profiles.map((p: any) => [p.sessionId as string, p.handle as string | null]));

  res.json({
    days,
    totals,
    sites: [...perSite.values()],
    topVideos: topVideoIds.map((id) => ({ videoId: id, title: title.get(id) ?? '(deleted video)', ...videoStats.get(id)! })),
    topCreators: topCreatorIds.map((id) => ({ handle: handle.get(id) ?? 'unknown', ...creatorStats.get(id)! })),
  });
});

// GET /api/admin/attribution/guardrail?days=30
// Do product tags hurt viewing? (exposed vs randomized hold-out on the same tagged videos), plus the
// shop funnel: tags shown → saved → clicked → sold.
router.get('/guardrail', requirePermission('attribution.view'), async (req: AuthedRequest, res: Response) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const since = utcDay(new Date(Date.now() - days * 86_400_000));
  const sinceTs = new Date(Date.now() - days * 86_400_000);

  const [groups, impressions, saves, clicks, convs, sites] = await Promise.all([
    prisma.videoDailyStat.groupBy({ by: ['cohort'], where: { day: { gte: since } }, _sum: { sessions: true, completions: true, sumWatchMs: true, sumFrac: true, sumFracSq: true } }),
    prisma.siteDailyStat.groupBy({ by: ['siteId'], where: { day: { gte: since } }, _sum: { impressions: true } }),
    prisma.savedItem.groupBy({ by: ['siteId'], where: { createdAt: { gte: sinceTs } }, _count: { _all: true } }),
    prisma.click.groupBy({ by: ['siteId'], where: { createdAt: { gte: sinceTs } }, _count: { _all: true } }),
    prisma.conversion.groupBy({ by: ['siteId'], where: { createdAt: { gte: sinceTs } }, _count: { _all: true } }),
    prisma.site.findMany({ select: { id: true, name: true } }),
  ]);

  const sums = (cohort: string): CohortSums => {
    const g: any = (groups as any[]).find((x) => x.cohort === cohort);
    const s = g?._sum ?? {};
    return { sessions: s.sessions ?? 0, completions: s.completions ?? 0, sumWatchMs: Number(s.sumWatchMs ?? 0), sumFrac: s.sumFrac ?? 0, sumFracSq: s.sumFracSq ?? 0 };
  };
  const exposed = summarize(sums('exposed'));
  const holdout = summarize(sums('holdout'));

  const count = (rows: any[], siteId: string, field: '_count' | '_sum') =>
    field === '_count' ? rows.find((r) => r.siteId === siteId)?._count._all ?? 0 : rows.find((r) => r.siteId === siteId)?._sum.impressions ?? 0;
  const rate = (a: number, b: number) => (b > 0 ? a / b : null);
  const funnel = (sites as any[]).map((s) => {
    const imp = count(impressions as any[], s.id, '_sum');
    const sv = count(saves as any[], s.id, '_count');
    const cl = count(clicks as any[], s.id, '_count');
    const cv = count(convs as any[], s.id, '_count');
    return { site: s.name, impressions: imp, saves: sv, clicks: cl, sales: cv, saveRate: rate(sv, imp), clickRate: rate(cl, imp), saleRate: rate(cv, cl) };
  }).filter((f) => f.impressions || f.saves || f.clicks || f.sales);

  res.json({
    days,
    holdoutPct: holdoutPct(),
    cohorts: { exposed, holdout, untagged: summarize(sums('untagged')) },
    comparison: compare(exposed, holdout),
    funnel,
  });
});

// GET /api/admin/attribution/payouts?status=&page=
router.get('/payouts', requirePermission('payouts.view'), async (req: AuthedRequest, res: Response) => {
  const { page, limit, skip, take } = parsePage(req, 25);
  const status = String(req.query.status || '');
  const where: any = status ? { status } : {};
  const [total, rows] = await Promise.all([
    prisma.payoutEntry.count({ where }),
    prisma.payoutEntry.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, include: { conversion: { select: { externalOrderId: true, amountMinor: true, site: { select: { name: true } }, click: { select: { video: { select: { title: true } } } } } } } }),
  ]);
  const profiles = await prisma.sessionProfile.findMany({ where: { sessionId: { in: [...new Set((rows as any[]).map((r) => r.creatorSessionId as string))] } }, select: { sessionId: true, handle: true } });
  const handle = new Map<string, string | null>(profiles.map((p: any) => [p.sessionId as string, p.handle as string | null]));
  res.json({
    entries: (rows as any[]).map((r) => ({
      id: r.id,
      creator: handle.get(r.creatorSessionId) ?? 'unknown',
      amount: fromMinor(r.amountMinor),
      currency: r.currency,
      status: r.status,
      createdAt: r.createdAt,
      site: r.conversion?.site?.name ?? '',
      orderId: r.conversion?.externalOrderId ?? '',
      orderAmount: r.conversion ? fromMinor(r.conversion.amountMinor) : 0,
      videoTitle: r.conversion?.click?.video?.title ?? null,
    })),
    ...pageMeta(page, limit, total),
  });
});

// PATCH /api/admin/attribution/payouts/:id  { status }
router.patch('/payouts/:id', requirePermission('payouts.manage'), async (req: AuthedRequest, res: Response) => {
  const next = String(req.body?.status || '');
  if (!(PAYOUT_STATUSES as readonly string[]).includes(next)) throw new HttpError(400, `status must be one of ${PAYOUT_STATUSES.join(', ')}`);
  const entry = await prisma.payoutEntry.findUnique({ where: { id: req.params.id } });
  if (!entry) throw new HttpError(404, 'Payout entry not found');
  if (!canTransition(entry.status, next)) throw new HttpError(409, `Can’t move a ${entry.status} entry to ${next}`);
  // Conditional on the current status so two admins can't both apply a transition.
  const changed = await prisma.payoutEntry.updateMany({ where: { id: entry.id, status: entry.status }, data: { status: next } });
  if (changed.count === 0) throw new HttpError(409, 'This entry was just changed by someone else — reload and try again');
  audit(req, 'payout.status', 'payout', entry.id, `${entry.status} → ${next}`);
  res.json({ ok: true, status: next });
});

export default router;
