import { Router, Response } from 'express';
import { prisma } from '../../db';
import { AuthedRequest, requirePermission } from '../../middleware/requireAdmin';
import { HttpError } from '../../lib/httpError';
import { audit } from '../../lib/audit';
import { parsePage, pageMeta } from '../../lib/pagination';
import { recountComments } from './helpers';

const router = Router();

// GET /api/admin/comments?q=&videoId=&page=&limit=
router.get('/', requirePermission('comments.view'), async (req: AuthedRequest, res: Response) => {
  const { page, limit, skip, take } = parsePage(req);
  const q = String(req.query.q || '').trim();
  const videoId = String(req.query.videoId || '');
  const where: any = {};
  if (q) where.OR = [{ text: { contains: q, mode: 'insensitive' } }, { author: { contains: q, mode: 'insensitive' } }];
  if (videoId) where.videoId = videoId;

  const [total, comments] = await Promise.all([
    prisma.comment.count({ where }),
    prisma.comment.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, include: { video: { select: { id: true, title: true } } } }),
  ]);
  res.json({
    comments: comments.map((c: any) => ({
      id: c.id,
      text: c.text,
      author: c.author,
      likes: c.likes,
      isReply: !!c.parentId,
      createdAt: c.createdAt,
      video: c.video ? { id: c.video.id, title: c.video.title } : null,
    })),
    ...pageMeta(page, limit, total),
  });
});

// PATCH /api/admin/comments/:id  { text }
router.patch('/:id', requirePermission('comments.edit'), async (req: AuthedRequest, res: Response) => {
  const text = String(req.body.text ?? '').trim().slice(0, 1000);
  if (!text) throw new HttpError(400, 'Comment text cannot be empty');
  const comment = await prisma.comment.findUnique({ where: { id: req.params.id } });
  if (!comment) throw new HttpError(404, 'Comment not found');
  await prisma.comment.update({ where: { id: comment.id }, data: { text } });
  audit(req, 'comment.update', 'comment', comment.id);
  res.status(204).send();
});

// DELETE /api/admin/comments/:id — also removes its replies (FK cascade), so the video's counter is recomputed.
router.delete('/:id', requirePermission('comments.delete'), async (req: AuthedRequest, res: Response) => {
  const comment = await prisma.comment.findUnique({ where: { id: req.params.id } });
  if (!comment) throw new HttpError(404, 'Comment not found');
  await prisma.comment.delete({ where: { id: comment.id } });
  await recountComments([comment.videoId]);
  audit(req, 'comment.delete', 'comment', comment.id, comment.text.slice(0, 120));
  res.status(204).send();
});

export default router;
