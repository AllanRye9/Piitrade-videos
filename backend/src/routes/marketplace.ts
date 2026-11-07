import { Router, Request, Response } from 'express';
import { HttpError } from '../lib/httpError';
import * as marketplace from '../lib/marketplace';
import { toSearchResultDto, browseUrlFor } from '../lib/marketplace';

const router = Router();

// GET /api/marketplace/search?q=<text> — manual, user-typed search of
// the piitrade.com classifieds.
//
// Independent of the AI-identify pipeline in visualSearch.ts: this
// lets a viewer type their own words and search the marketplace
// directly, which doubles as a way to verify whether an item genuinely
// exists there (bypassing whatever the AI identified). Uses the same
// query-shortening fallback as the visual-search pipeline, since the
// marketplace's own search is a verbatim substring match and even a
// typed multi-word phrase can miss a shorter real listing title.
//
// Read-only on purpose: piitrade.com is a classifieds site, so there
// is nothing to buy or check out here — each result's `listingUrl`
// opens the listing on piitrade.com, and `browseUrl` opens the full
// result set there.
router.get('/search', async (req: Request, res: Response) => {
  const q = req.query.q;
  if (typeof q !== 'string' || !q.trim()) {
    throw new HttpError(400, 'q query parameter is required');
  }
  console.log(`[Marketplace] manual search: "${q}"`);
  const outcome = await marketplace.searchProductsWithFallback(q);
  const results = outcome.results.slice(0, 12).map((p) => toSearchResultDto(p, q));
  res.json({ results, matchedQuery: outcome.matchedQuery, browseUrl: browseUrlFor(outcome.matchedQuery || q) });
});

export default router;
