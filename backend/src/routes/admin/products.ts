import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { prisma } from '../../db';
import { AuthedRequest, requirePermission } from '../../middleware/requireAdmin';
import { uploadImage } from '../../middleware/upload';
import { computeImageHash } from '../../lib/search/phash';
import { HttpError } from '../../lib/core/httpError';
import { toJpeg } from '../../lib/core/image';
import { audit } from '../../lib/core/audit';
import { PRODUCTS_DIR } from '../../paths';

const router = Router();

function serialize(p: { id: string; name: string; price: string; category: string; imageFilename: string }) {
  return { id: p.id, name: p.name, price: p.price, category: p.category, image: `/uploads/products/${p.imageFilename}` };
}

// GET /api/admin/products?q=
router.get('/', requirePermission('products.view'), async (req: AuthedRequest, res: Response) => {
  const q = String(req.query.q || '').trim();
  const products = await prisma.product.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { category: { contains: q, mode: 'insensitive' } }] } : undefined,
    orderBy: { name: 'asc' },
  });
  res.json({ products: products.map(serialize) });
});

// POST /api/admin/products  (multipart: image, name, price, category)
router.post('/', requirePermission('products.create'), uploadImage.single('image'), async (req: AuthedRequest, res: Response) => {
  const file = req.file;
  if (!file) throw new HttpError(400, 'A product image is required');

  const name = String(req.body.name || '').trim().slice(0, 200);
  const price = String(req.body.price || '').trim().slice(0, 40);
  const category = String(req.body.category || '').trim().slice(0, 80);
  if (!name || !price || !category) throw new HttpError(400, 'name, price, and category are required');

  const imageFilename = `${uuid()}.jpg`;
  const buffer = await toJpeg(file.buffer, { quality: 88 });
  fs.writeFileSync(path.join(PRODUCTS_DIR, imageFilename), buffer);
  const phash = await computeImageHash(buffer);

  const product = await prisma.product.create({ data: { name, price, category, imageFilename, phash } });
  audit(req, 'product.create', 'product', product.id, name);
  res.status(201).json({ product: serialize(product) });
});

// PATCH /api/admin/products/:id  (multipart optional: image, name, price, category)
router.patch('/:id', requirePermission('products.edit'), uploadImage.single('image'), async (req: AuthedRequest, res: Response) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) throw new HttpError(404, 'Product not found');

  const data: Record<string, string> = {};
  if (req.body.name !== undefined) data.name = String(req.body.name).trim().slice(0, 200);
  if (req.body.price !== undefined) data.price = String(req.body.price).trim().slice(0, 40);
  if (req.body.category !== undefined) data.category = String(req.body.category).trim().slice(0, 80);

  if (req.file) {
    const buffer = await toJpeg(req.file.buffer, { quality: 88 });
    const imageFilename = `${uuid()}.jpg`;
    fs.writeFileSync(path.join(PRODUCTS_DIR, imageFilename), buffer);
    const oldFile = path.join(PRODUCTS_DIR, product.imageFilename);
    if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
    data.imageFilename = imageFilename;
    data.phash = await computeImageHash(buffer);
  }

  const updated = await prisma.product.update({ where: { id: product.id }, data });
  audit(req, 'product.update', 'product', product.id, updated.name);
  res.json({ product: serialize(updated) });
});

// DELETE /api/admin/products/:id
router.delete('/:id', requirePermission('products.delete'), async (req: AuthedRequest, res: Response) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) throw new HttpError(404, 'Product not found');

  await prisma.product.delete({ where: { id: product.id } });
  const file = path.join(PRODUCTS_DIR, product.imageFilename);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  audit(req, 'product.delete', 'product', product.id, product.name);
  res.status(204).send();
});

export default router;
