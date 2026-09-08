import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { uploadImage } from '../middleware/upload';
import { computeImageHash, hammingDistance, similarityScore } from '../lib/phash';
import { identifyImage } from '../lib/aiSearch';
import { searchProducts } from '../lib/marketplace';

const router = Router();

/**
 * Whether the AI-identify + marketplace pipeline is configured. Both
 * env vars are required together — if only one is set, that's a
 * misconfiguration, and we fall back to the local phash catalog rather
 * than partially failing, so the search feature keeps working either
 * way (see README "Visual search modes").
 */
function marketplacePipelineEnabled(): boolean {
  return Boolean(process.env.AI_SEARCH && process.env.MARKETPLACE_API);
}

// POST /api/visual-search  (multipart: image)
router.post('/', uploadImage.single('image'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No image uploaded' });
    return;
  }

  if (marketplacePipelineEnabled()) {
    // 1. Ask the configured AI service what the cropped selection shows.
    const identification = await identifyImage(file.buffer, file.mimetype);
    // 2. Ask the marketplace whether it carries anything matching that
    //    identification, and shape the response into the same display
    //    shape the frontend already renders (SearchResultsPanel).
    const products = await searchProducts(identification.text);
    const results = products.slice(0, 12).map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      category: identification.text,
      image: p.image,
      description: p.description,
      productUrl: p.url,
      inStock: p.inStock ?? true,
      sellerId: p.sellerId,
      match: 100,
    }));
    res.json({ results, identification: identification.text });
    return;
  }

  // Fallback: local perceptual-hash match against the seeded product
  // catalog (see backend/src/lib/phash.ts). This is what runs when
  // AI_SEARCH / MARKETPLACE_API are not configured, e.g. local dev.
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
