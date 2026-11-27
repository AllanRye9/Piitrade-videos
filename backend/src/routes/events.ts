import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { eventsLimiter } from '../middleware/rateLimit';
import { getSessionId } from './videos';
import { Cohort, inHoldout, parseEvents, utcDay, watchFacts } from '../lib/feed/guardrail';

/**
 * Viewing analytics from the app, batched. Stores only per-video / per-day SUMS (no per-viewer rows):
 * what's needed to answer "do product tags hurt watch time?" and to report tag impressions to shops.
 * It never fails the app: malformed events are dropped, and the answer is always 202.
 */
const router = Router();

interface Bump {
  sessions: number;
  completions: number;
  sumWatchMs: number;
  sumFrac: number;
  sumFracSq: number;
}

async function bumpVideoStat(videoId: string, day: Date, cohort: Cohort, d: Bump): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await prisma.videoDailyStat.upsert({
        where: { videoId_day_cohort: { videoId, day, cohort } },
        create: { videoId, day, cohort, sessions: d.sessions, completions: d.completions, sumWatchMs: BigInt(d.sumWatchMs), sumFrac: d.sumFrac, sumFracSq: d.sumFracSq },
        update: {
          sessions: { increment: d.sessions },
          completions: { increment: d.completions },
          sumWatchMs: { increment: BigInt(d.sumWatchMs) },
          sumFrac: { increment: d.sumFrac },
          sumFracSq: { increment: d.sumFracSq },
        },
      });
      return;
    } catch (err: any) {
      // Two requests created the same row at once: the second attempt takes the update path.
      if (err?.code !== 'P2002' || attempt === 1) throw err;
    }
  }
}

// POST /api/events  { events: [{ type: 'watch', videoId, watchedMs, durationMs? } | { type: 'chip', videoId, productId }] }
router.post('/', eventsLimiter, async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  const events = sessionId === 'anonymous' ? [] : parseEvents(req.body);
  if (events.length === 0) {
    res.status(202).json({ accepted: 0 });
    return;
  }

  const videoIds = [...new Set(events.map((e) => e.videoId))];
  const [videos, tagged] = await Promise.all([
    prisma.video.findMany({ where: { id: { in: videoIds } }, select: { id: true, duration: true, uploaderSessionId: true } }),
    prisma.videoProduct.groupBy({ by: ['videoId'], where: { videoId: { in: videoIds }, site: { active: true } }, _count: { _all: true } }),
  ]);
  const byId = new Map<string, { duration: number | null; uploaderSessionId: string | null }>(videos.map((v: any) => [v.id as string, v]));
  const taggedIds = new Set<string>(tagged.map((t: any) => t.videoId as string));
  const held = inHoldout(sessionId);
  const day = utcDay();

  // Sum this batch per (video, cohort) first: one upsert per group, not one per event.
  const sums = new Map<string, { videoId: string; cohort: Cohort; d: Bump }>();
  const chipProducts: Array<{ videoId: string; productId: string }> = [];
  let accepted = 0;

  for (const e of events) {
    const v = byId.get(e.videoId);
    if (!v) continue;
    if (v.uploaderSessionId === sessionId) continue; // creators re-watching their own video would skew the numbers
    if (e.type === 'watch') {
      const facts = watchFacts(e.watchedMs, v.duration, e.durationMs);
      if (!facts) continue;
      const cohort: Cohort = !taggedIds.has(e.videoId) ? 'untagged' : held ? 'holdout' : 'exposed';
      const k = `${e.videoId}|${cohort}`;
      const g = sums.get(k) ?? { videoId: e.videoId, cohort, d: { sessions: 0, completions: 0, sumWatchMs: 0, sumFrac: 0, sumFracSq: 0 } };
      g.d.sessions += 1;
      g.d.completions += facts.completed ? 1 : 0;
      g.d.sumWatchMs += facts.watchMs;
      g.d.sumFrac += facts.frac;
      g.d.sumFracSq += facts.frac * facts.frac;
      sums.set(k, g);
      accepted++;
    } else if (!held) {
      // Hold-out viewers aren't shown tags, so there's nothing to count for them.
      chipProducts.push({ videoId: e.videoId, productId: e.productId });
      accepted++;
    }
  }

  for (const g of sums.values()) await bumpVideoStat(g.videoId, day, g.cohort, g.d);

  if (chipProducts.length) {
    const products = await prisma.videoProduct.findMany({
      where: { id: { in: [...new Set(chipProducts.map((c) => c.productId))] }, site: { active: true } },
      select: { id: true, videoId: true, siteId: true },
    });
    const siteOf = new Map<string, string>(products.map((p: any) => [`${p.videoId}|${p.id}`, p.siteId as string]));
    const perSite = new Map<string, number>();
    for (const c of chipProducts) {
      const siteId = siteOf.get(`${c.videoId}|${c.productId}`);
      if (siteId) perSite.set(siteId, (perSite.get(siteId) || 0) + 1);
    }
    for (const [siteId, n] of perSite) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await prisma.siteDailyStat.upsert({ where: { siteId_day: { siteId, day } }, create: { siteId, day, impressions: n }, update: { impressions: { increment: n } } });
          break;
        } catch (err: any) {
          if (err?.code !== 'P2002' || attempt === 1) throw err;
        }
      }
    }
  }

  res.status(202).json({ accepted });
});

export default router;
