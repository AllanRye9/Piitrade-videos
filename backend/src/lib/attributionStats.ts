import { prisma } from '../db';
import { sumByCurrency } from './attribution';

/** Aggregates clicks + sales for one site (or all sites when siteId is undefined) since a date. Amounts are minor units. */
export async function attributionStats(siteId: string | undefined, since: Date) {
  const clickWhere = { createdAt: { gte: since }, ...(siteId ? { siteId } : {}) };
  const convWhere = { createdAt: { gte: since }, ...(siteId ? { siteId } : {}) };

  const [clicks, convGroups, topVideoClicks, topCreatorRows] = await Promise.all([
    prisma.click.count({ where: clickWhere }),
    prisma.conversion.groupBy({ by: ['currency', 'status'], where: convWhere, _sum: { amountMinor: true, commissionMinor: true }, _count: { _all: true } }),
    prisma.click.groupBy({ by: ['videoId'], where: clickWhere, _count: { _all: true }, orderBy: { _count: { videoId: 'desc' } }, take: 10 }),
    prisma.conversion.groupBy({
      by: ['creatorSessionId', 'currency'],
      where: { ...convWhere, status: { not: 'reversed' } },
      _sum: { amountMinor: true, commissionMinor: true },
      _count: { _all: true },
      orderBy: { _sum: { amountMinor: 'desc' } },
      take: 10,
    }),
  ]);

  type Group = { currency: string; status: string; _sum: { amountMinor: number | null; commissionMinor: number | null }; _count: { _all: number } };
  const byCurrency: Record<string, { conversions: number; revenueMinor: number; commissionMinor: number; reversed: number }> = {};
  let conversions = 0;
  for (const g of convGroups as Group[]) {
    const key = g.currency || '—';
    const row = (byCurrency[key] ??= { conversions: 0, revenueMinor: 0, commissionMinor: 0, reversed: 0 });
    if (g.status === 'reversed') {
      row.reversed += g._count._all;
      continue;
    }
    row.conversions += g._count._all;
    row.revenueMinor += g._sum.amountMinor ?? 0;
    row.commissionMinor += g._sum.commissionMinor ?? 0;
    conversions += g._count._all;
  }

  const videoIds = (topVideoClicks as Array<{ videoId: string }>).map((r) => r.videoId);
  const creatorIds = (topCreatorRows as Array<{ creatorSessionId: string | null }>).map((r) => r.creatorSessionId).filter((x): x is string => !!x);
  const [videos, profiles] = await Promise.all([
    videoIds.length ? prisma.video.findMany({ where: { id: { in: videoIds } }, select: { id: true, title: true } }) : [],
    creatorIds.length ? prisma.sessionProfile.findMany({ where: { sessionId: { in: creatorIds } }, select: { sessionId: true, handle: true, displayName: true } }) : [],
  ]);
  const title = new Map<string, string>((videos as Array<{ id: string; title: string }>).map((v) => [v.id, v.title]));
  const handle = new Map<string, string>((profiles as Array<{ sessionId: string; handle: string | null; displayName: string | null }>).map((p) => [p.sessionId, p.displayName || (p.handle ? `@${p.handle}` : 'creator')]));

  return {
    since,
    clicks,
    conversions,
    byCurrency,
    topVideos: (topVideoClicks as Array<{ videoId: string; _count: { _all: number } }>).map((r) => ({ videoId: r.videoId, title: title.get(r.videoId) ?? '(deleted video)', clicks: r._count._all })),
    topCreators: (topCreatorRows as Array<{ creatorSessionId: string | null; currency: string; _sum: { amountMinor: number | null; commissionMinor: number | null }; _count: { _all: number } }>).map((r) => ({
      creator: r.creatorSessionId ? handle.get(r.creatorSessionId) ?? 'creator' : 'unknown',
      currency: r.currency || '—',
      conversions: r._count._all,
      revenueMinor: r._sum.amountMinor ?? 0,
      commissionMinor: r._sum.commissionMinor ?? 0,
    })),
  };
}

/** A creator's ledger balances (per currency) plus recent entries. */
export async function creatorEarnings(sessionId: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [rows, recent, clicks30] = await Promise.all([
    prisma.conversion.findMany({ where: { creatorSessionId: sessionId }, select: { currency: true, status: true, commissionMinor: true } }),
    prisma.conversion.findMany({ where: { creatorSessionId: sessionId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.click.count({ where: { creatorSessionId: sessionId, createdAt: { gte: since } } }),
  ]);
  const videoIds = [...new Set((recent as Array<{ videoId: string }>).map((r) => r.videoId))];
  const siteIds = [...new Set((recent as Array<{ siteId: string }>).map((r) => r.siteId))];
  const [videos, sites] = await Promise.all([
    videoIds.length ? prisma.video.findMany({ where: { id: { in: videoIds } }, select: { id: true, title: true } }) : [],
    siteIds.length ? prisma.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, name: true } }) : [],
  ]);
  const vt = new Map<string, string>((videos as Array<{ id: string; title: string }>).map((v) => [v.id, v.title]));
  const sn = new Map<string, string>((sites as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]));
  return {
    balances: sumByCurrency(rows),
    clicksLast30Days: clicks30,
    recent: (recent as Array<{ id: string; videoId: string; siteId: string; currency: string; amountMinor: number; commissionMinor: number; status: string; createdAt: Date }>).map((r) => ({
      id: r.id,
      video: vt.get(r.videoId) ?? '(deleted video)',
      site: sn.get(r.siteId) ?? '(removed site)',
      currency: r.currency || '—',
      saleMinor: r.amountMinor,
      commissionMinor: r.commissionMinor,
      status: r.status,
      createdAt: r.createdAt,
    })),
  };
}
