import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { prisma } from '../db';
import { requireAdmin } from '../middleware/requireAdmin';
import { uploadImage } from '../middleware/upload';
import { computeImageHash } from '../lib/phash';
import { HttpError } from '../lib/httpError';
import { PRODUCTS_DIR, VIDEOS_DIR, POSTERS_DIR } from '../paths';
import { v4 as uuid } from 'uuid';
import { resolveAssetUrl } from './videos';

const router = Router();
router.use(requireAdmin);

// GET /api/admin/stats
router.get('/stats', async (_req: Request, res: Response) => {
  const [videoCount, commentCount, productCount, aggregates] = await Promise.all([
    prisma.video.count(),
    prisma.comment.count(),
    prisma.product.count(),
    prisma.video.aggregate({ _sum: { views: true, likes: true } }),
  ]);
  res.json({
    videos: videoCount,
    comments: commentCount,
    products: productCount,
    totalViews: aggregates._sum.views || 0,
    totalLikes: aggregates._sum.likes || 0,
  });
});

// GET /api/admin/videos — full list, no session-state merging needed for admin view
router.get('/videos', async (_req: Request, res: Response) => {
  const videos = await prisma.video.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({
    videos: videos.map((v: any) => ({
      id: v.id,
      title: v.title,
      description: v.description,
      url: resolveAssetUrl(v.filename, 'videos'),
      poster: v.posterFilename ? resolveAssetUrl(v.posterFilename, 'posters') : null,
      likes: v.likes,
      views: v.views,
      comments: v.comments,
      createdAt: v.createdAt,
    })),
  });
});

// PATCH /api/admin/videos/:id — edit title/description
router.patch('/videos/:id', async (req: Request, res: Response) => {
  const title = req.body.title !== undefined ? String(req.body.title).slice(0, 200) : undefined;
  const description = req.body.description !== undefined ? String(req.body.description).slice(0, 1000) : undefined;
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new HttpError(404, 'Video not found');

  const updated = await prisma.video.update({
    where: { id: video.id },
    data: { ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}) },
  });
  res.json({ video: updated });
});

// DELETE /api/admin/videos/:id
router.delete('/videos/:id', async (req: Request, res: Response) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new HttpError(404, 'Video not found');

  await prisma.video.delete({ where: { id: video.id } });

  // filename/posterFilename are either local disk filenames or full
  // VIDEO_STORE (ImageKit) URLs — see resolveAssetUrl in routes/videos.ts.
  // Only the local case can be cleaned up here: joining a remote URL
  // onto VIDEOS_DIR/POSTERS_DIR doesn't produce a real path, so that
  // branch is skipped rather than attempted and silently doing
  // nothing. Deleting the remote copy would need its ImageKit fileId,
  // which isn't stored (same documented tradeoff as avatar cleanup in
  // routes/profile.ts) — so it's logged as orphaned instead of
  // pretending it was cleaned up.
  const isRemote = (value: string) => /^https?:\/\//i.test(value);

  if (isRemote(video.filename)) {
    console.warn(`[Admin] deleted video ${video.id}, but its VIDEO_STORE file was not — no fileId stored: ${video.filename}`);
  } else {
    const videoFile = path.join(VIDEOS_DIR, video.filename);
    if (fs.existsSync(videoFile)) fs.unlinkSync(videoFile);
  }

  if (video.posterFilename) {
    if (isRemote(video.posterFilename)) {
      console.warn(`[Admin] deleted video ${video.id}, but its poster on VIDEO_STORE was not — no fileId stored: ${video.posterFilename}`);
    } else {
      const posterFile = path.join(POSTERS_DIR, video.posterFilename);
      if (fs.existsSync(posterFile)) fs.unlinkSync(posterFile);
    }
  }
  res.status(204).send();
});

// GET /api/admin/videos/:id/comments
router.get('/videos/:id/comments', async (req: Request, res: Response) => {
  const comments = await prisma.comment.findMany({
    where: { videoId: req.params.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ comments });
});

// DELETE /api/admin/comments/:id
router.delete('/comments/:id', async (req: Request, res: Response) => {
  const comment = await prisma.comment.findUnique({ where: { id: req.params.id } });
  if (!comment) throw new HttpError(404, 'Comment not found');

  await prisma.$transaction([
    prisma.comment.delete({ where: { id: comment.id } }),
    prisma.video.update({ where: { id: comment.videoId }, data: { comments: { decrement: 1 } } }),
  ]);
  res.status(204).send();
});

// GET /api/admin/products
router.get('/products', async (_req: Request, res: Response) => {
  const products = await prisma.product.findMany({ orderBy: { name: 'asc' } });
  res.json({
    products: products.map((p: any) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      category: p.category,
      image: `/uploads/products/${p.imageFilename}`,
    })),
  });
});

// POST /api/admin/products  (multipart: image, name, price, category)
router.post('/products', uploadImage.single('image'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw new HttpError(400, 'A product image is required');

  const name = String(req.body.name || '').trim().slice(0, 200);
  const price = String(req.body.price || '').trim().slice(0, 40);
  const category = String(req.body.category || '').trim().slice(0, 80);
  if (!name || !price || !category) throw new HttpError(400, 'name, price, and category are required');

  const imageFilename = `${uuid()}.jpg`;
  const sharp = (await import('sharp')).default;
  const buffer = await sharp(file.buffer).jpeg({ quality: 88 }).toBuffer();
  fs.writeFileSync(path.join(PRODUCTS_DIR, imageFilename), buffer);
  const phash = await computeImageHash(buffer);

  const product = await prisma.product.create({ data: { name, price, category, imageFilename, phash } });
  res.status(201).json({ product: { id: product.id, name, price, category, image: `/uploads/products/${imageFilename}` } });
});

// PATCH /api/admin/products/:id  (multipart optional: image, name, price, category)
router.patch('/products/:id', uploadImage.single('image'), async (req: Request, res: Response) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) throw new HttpError(404, 'Product not found');

  const data: Record<string, string> = {};
  if (req.body.name !== undefined) data.name = String(req.body.name).trim().slice(0, 200);
  if (req.body.price !== undefined) data.price = String(req.body.price).trim().slice(0, 40);
  if (req.body.category !== undefined) data.category = String(req.body.category).trim().slice(0, 80);

  if (req.file) {
    const sharp = (await import('sharp')).default;
    const buffer = await sharp(req.file.buffer).jpeg({ quality: 88 }).toBuffer();
    const imageFilename = `${uuid()}.jpg`;
    fs.writeFileSync(path.join(PRODUCTS_DIR, imageFilename), buffer);
    const oldFile = path.join(PRODUCTS_DIR, product.imageFilename);
    if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
    data.imageFilename = imageFilename;
    data.phash = await computeImageHash(buffer);
  }

  const updated = await prisma.product.update({ where: { id: product.id }, data });
  res.json({
    product: {
      id: updated.id,
      name: updated.name,
      price: updated.price,
      category: updated.category,
      image: `/uploads/products/${updated.imageFilename}`,
    },
  });
});

// DELETE /api/admin/products/:id
router.delete('/products/:id', async (req: Request, res: Response) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) throw new HttpError(404, 'Product not found');

  await prisma.product.delete({ where: { id: product.id } });
  const file = path.join(PRODUCTS_DIR, product.imageFilename);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.status(204).send();
});

export default router;
