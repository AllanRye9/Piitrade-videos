import { Router, Response } from 'express';
import { prisma } from '../../db';
import { AuthedRequest, requirePermission } from '../../middleware/requireAdmin';
import { audit } from '../../lib/audit';
import { resolveAssetUrl } from '../videos';

const router = Router();

// GET /api/admin/reports — moderation queue grouped by video: count, distinct
// reasons, newest-reported first.
router.get('/', requirePermission('reports.view'), async (_req: AuthedRequest, res: Response) => {
  const grouped = await prisma.report.groupBy({
    by: ['videoId'],
    _count: { _all: true },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: 'desc' } },
  });
  if (grouped.length === 0) {
    res.json({ reports: [] });
    return;
  }

  const videoIds = grouped.map((g: { videoId: string }) => g.videoId);
  const [videos, reasonRows] = await Promise.all([
    prisma.video.findMany({ where: { id: { in: videoIds } } }),
    prisma.report.findMany({ where: { videoId: { in: videoIds } }, select: { videoId: true, reason: true } }),
  ]);
  const videoMap = new Map<string, any>(videos.map((v: any) => [v.id as string, v]));
  const reasonsByVideo = new Map<string, Set<string>>();
  for (const r of reasonRows as { videoId: string; reason: string }[]) {
    if (!reasonsByVideo.has(r.videoId)) reasonsByVideo.set(r.videoId, new Set());
    reasonsByVideo.get(r.videoId)!.add(r.reason);
  }

  res.json({
    reports: grouped
      .map((g: { videoId: string; _count: { _all: number }; _max: { createdAt: Date | null } }) => {
        const video = videoMap.get(g.videoId);
        if (!video) return null;
        return {
          videoId: g.videoId,
          title: video.title,
          url: resolveAssetUrl(video.filename, 'videos'),
          poster: video.posterFilename ? resolveAssetUrl(video.posterFilename, 'posters') : null,
          reportCount: g._count._all,
          reasons: [...(reasonsByVideo.get(g.videoId) || [])],
          lastReportedAt: g._max.createdAt,
        };
      })
      .filter((r: unknown): r is NonNullable<typeof r> => r !== null),
  });
});

// DELETE /api/admin/reports/:videoId — dismiss all reports for a video (reviewed, it's fine).
// To remove the video itself use DELETE /api/admin/videos/:id.
router.delete('/:videoId', requirePermission('reports.delete'), async (req: AuthedRequest, res: Response) => {
  await prisma.report.deleteMany({ where: { videoId: req.params.videoId } });
  audit(req, 'report.dismiss', 'video', req.params.videoId);
  res.status(204).send();
});

export default router;
