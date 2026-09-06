import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { uploadImage } from '../middleware/upload';
import { computeImageHash, hammingDistance, similarityScore } from '../lib/phash';

const router = Router();

// POST /api/visual-search  (multipart: image)
router.post('/', uploadImage.single('image'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No image uploaded' });
    return;
  }

  let queryHash: string;
  try {
    queryHash = await computeImageHash(file.buffer);
  } catch (err) {
    res.status(422).json({ error: 'Could not process the selected image' });
    return;
  }

  const products: Array<{ id: string; name: string; price: string; category: string; imageFilename: string; phash: string }> =
    await prisma.product.findMany();
  const ranked = products
    .map((p) => {
      const distance = hammingDistance(queryHash, p.phash);
      return {
        id: p.id,
        name: p.name,
        price: p.price,
        category: p.category,
        image: `/uploads/products/${p.imageFilename}`,
        match: similarityScore(distance),
        distance,
      };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 6)
    .map(({ distance, ...rest }: { distance: number; [key: string]: unknown }) => rest);

  res.json({ results: ranked });
});

export default router;
