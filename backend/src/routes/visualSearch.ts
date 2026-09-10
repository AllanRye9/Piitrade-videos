import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { uploadImage } from '../middleware/upload';
import { computeImageHash, hammingDistance, similarityScore } from '../lib/phash';
import { identifyImage } from '../lib/aiSearch';
import { fuzzySearchProducts } from '../lib/marketplace';

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

  console.log(`[VisualSearch] received ${file.size} byte ${file.mimetype} selection`);

  if (marketplacePipelineEnabled()) {
    console.log('[VisualSearch] pipeline: AI_SEARCH identify -> MARKETPLACE_API fuzzy search (both configured)');
    // 1. Ask the configured AI service what the cropped selection shows.
    const identification = await identifyImage(file.buffer, file.mimetype);
    // 2. Ask the marketplace whether it carries anything matching that
    //    identification. The identified phrase rarely matches a
    //    listing's title verbatim, so this doesn't stop at one exact
    //    query — it regex/chunk-matches (3-7 letter substrings) and
    //    falls back to chunk-by-chunk marketplace searches until
    //    something is found or every chunk has been exhausted (see
    //    fuzzySearchProducts in lib/marketplace.ts for the full
    //    algorithm and its own step-by-step console logging).
    const products = await fuzzySearchProducts(identification.text);
    const exists = products.length > 0;
    console.log(
      `[VisualSearch] "${identification.text}" ${exists ? `EXISTS — ${products.length} matching listing(s)` : 'DOES NOT EXIST in the marketplace'}`
    );

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
      match: p.matchScore,
    }));
    console.log(`[VisualSearch] returning ${results.length} result(s) to the client for "${identification.text}"`);
    res.json({ results, identification: identification.text, exists });
    return;
  }

  // Fallback: local perceptual-hash match against the seeded product
  // catalog (see backend/src/lib/phash.ts). This is what runs when
  // AI_SEARCH / MARKETPLACE_API are not configured, e.g. local dev.
  console.log(
    '[VisualSearch] pipeline: local phash catalog (AI_SEARCH and/or MARKETPLACE_API not both configured — set both to use the real marketplace)'
  );
  let queryHash: string;
  try {
    queryHash = await computeImageHash(file.buffer);
  } catch (err) {
    console.error('[VisualSearch] phash: could not process image:', err instanceof Error ? err.message : err);
    res.status(422).json({ error: 'Could not process the selected image' });
    return;
  }

  const products: Array<{ id: string; name: string; price: string; category: string; imageFilename: string; phash: string }> =
    await prisma.product.findMany();
  console.log(`[VisualSearch] phash: comparing against ${products.length} catalog product(s)`);
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

  console.log(
    `[VisualSearch] phash: top match ${ranked[0] ? `"${ranked[0].name}" (${ranked[0].match}% similar)` : 'none'}, returning ${ranked.length} result(s)`
  );
  res.json({ results: ranked, exists: ranked.length > 0 });
});

export default router;
