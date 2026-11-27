import { prisma } from '../../db';
import { HttpError } from '../core/httpError';
import { searchProductsWithFallback, type MarketplaceProduct, type ShopTarget } from './marketplace';

const SHOP_CACHE_MS = 15_000;
const SHOP_SEARCH_BUDGET_MS = 10_000;

interface SearchShop extends ShopTarget {
  active: boolean;
}

interface ShopCache {
  expiresAt: number;
  hasSites: boolean;
  targets: ShopTarget[];
}

interface ShopRef {
  id: string;
  name: string;
  count: number;
}

export interface SearchSitesOutcome {
  results: MarketplaceProduct[];
  matchedQuery: string | null;
  searched: ShopRef[];
  failed: Array<{ id: string; name: string }>;
}

let shopCache: ShopCache | null = null;
let shopCacheRequest: Promise<ShopCache> | null = null;

export function invalidateShopCache(): void {
  shopCache = null;
}

async function loadShopCache(): Promise<ShopCache> {
  const now = Date.now();
  if (shopCache && shopCache.expiresAt > now) return shopCache;
  if (shopCacheRequest) return shopCacheRequest;

  const request: Promise<ShopCache> = prisma.site.findMany({
    select: { id: true, name: true, baseUrl: true, apiBase: true, country: true, currency: true, active: true },
  }).then((sites: SearchShop[]) => {
    const cache: ShopCache = {
      expiresAt: Date.now() + SHOP_CACHE_MS,
      hasSites: sites.length > 0,
      targets: sites
        .filter((site) => site.active && site.apiBase.trim())
        .map(({ id, name, baseUrl, apiBase, country, currency }) => ({
          id,
          name,
          baseUrl,
          apiBase,
          country,
          currency,
        })),
    };
    shopCache = cache;
    return cache;
  }).finally(() => {
    shopCacheRequest = null;
  });
  shopCacheRequest = request;
  return request;
}

export async function searchConfigured(): Promise<boolean> {
  const cache = await loadShopCache();
  return cache.targets.length > 0 || (!cache.hasSites && Boolean(process.env.MARKETPLACE_API));
}

function interleave(groups: MarketplaceProduct[][]): MarketplaceProduct[] {
  const results: MarketplaceProduct[] = [];
  const maxLength = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < maxLength; index++) {
    for (const group of groups) {
      if (group[index]) results.push(group[index]);
    }
  }
  return results;
}

export async function searchSites(query: string): Promise<SearchSitesOutcome> {
  const cache = await loadShopCache();
  if (cache.targets.length === 0) {
    if (!cache.hasSites && process.env.MARKETPLACE_API) {
      const outcome = await searchProductsWithFallback(query);
      return {
        results: outcome.results,
        matchedQuery: outcome.matchedQuery,
        searched: [{ id: 'piitrade', name: 'Piitrade', count: outcome.results.length }],
        failed: [],
      };
    }
    if (!cache.hasSites && !process.env.MARKETPLACE_API) {
      throw new HttpError(503, 'Marketplace is not configured (set MARKETPLACE_API)');
    }
    return { results: [], matchedQuery: null, searched: [], failed: [] };
  }

  const outcomes = await Promise.all(cache.targets.map(async (target) => {
    try {
      const result = await searchProductsWithFallback(query, target, { deadline: Date.now() + SHOP_SEARCH_BUDGET_MS });
      return { target, result, failed: false };
    } catch (error) {
      console.warn(`[Marketplace:${target.name}] search failed:`, error instanceof Error ? error.message : error);
      return { target, result: null, failed: true };
    }
  }));

  const successful = outcomes.filter((entry) => !entry.failed && entry.result !== null);
  const searched = successful.map(({ target, result }) => ({
    id: target.id,
    name: target.name,
    count: result!.results.length,
  }));
  const failed = outcomes.filter((entry) => entry.failed).map(({ target }) => ({ id: target.id, name: target.name }));

  return {
    results: interleave(successful.map(({ result }) => result!.results)),
    matchedQuery: successful.find(({ result }) => result?.matchedQuery)?.result?.matchedQuery ?? null,
    searched,
    failed,
  };
}
