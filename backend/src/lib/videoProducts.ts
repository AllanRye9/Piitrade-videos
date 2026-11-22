import { prisma } from '../db';
import type { CleanProduct, SiteRef } from './shoppable';
import { inHoldout } from './guardrail';

/** What clients see for a pinned product. The destination URL stays server-side: taps go through the attribution redirect. */
export interface PublicProduct {
  id: string;
  title: string;
  site: string;
  host: string;
  startMs: number;
  endMs: number | null;
  x: number | null;
  y: number | null;
  /** The requesting viewer has already saved this product. */
  saved: boolean;
}

export async function loadActiveSites(): Promise<SiteRef[]> {
  return prisma.site.findMany({ where: { active: true }, select: { id: true, baseUrl: true } });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function toPublicProduct(row: any, saved = false): PublicProduct {
  return {
    id: row.id,
    title: row.title,
    site: row.site?.name ?? '',
    host: hostOf(row.url),
    startMs: row.startMs,
    endMs: row.endMs ?? null,
    x: row.x ?? null,
    y: row.y ?? null,
    saved,
  };
}

/** Adds `products` to each serialized video with one query for the whole page. */
export async function attachProducts<T extends { id: string }>(items: T[], sessionId?: string): Promise<Array<T & { products: PublicProduct[] }>> {
  if (items.length === 0) return [];
  // Viewing guardrail: a small, stable share of viewers is shown no tags so their watch time can be
  // compared with everyone else's (see lib/guardrail.ts). A creator always sees their own tags.
  const held = !!sessionId && inHoldout(sessionId);
  const shown = held ? items.filter((i) => (i as any).uploader?.isOwn) : items;
  const rows = shown.length === 0 ? [] : await prisma.videoProduct.findMany({
    where: { videoId: { in: shown.map((i) => i.id) }, site: { active: true } },
    orderBy: [{ position: 'asc' }, { startMs: 'asc' }],
    include: { site: { select: { name: true } } },
  });
  // Which of these has this viewer already saved? One query for the whole page.
  let savedKeys = new Set<string>();
  if (sessionId && sessionId !== 'anonymous' && rows.length) {
    const keys = [...new Set((rows as any[]).map((r) => r.urlKey as string))];
    const saved = await prisma.savedItem.findMany({ where: { sessionId, urlKey: { in: keys } }, select: { urlKey: true } });
    savedKeys = new Set(saved.map((x: { urlKey: string }) => x.urlKey));
  }
  const byVideo = new Map<string, PublicProduct[]>();
  for (const r of rows as any[]) {
    const list = byVideo.get(r.videoId) ?? [];
    list.push(toPublicProduct(r, savedKeys.has(r.urlKey)));
    byVideo.set(r.videoId, list);
  }
  return items.map((i) => ({ ...i, products: byVideo.get(i.id) ?? [] }));
}

/** Replaces all products on a video atomically. */
export async function replaceVideoProducts(videoId: string, products: CleanProduct[]): Promise<void> {
  await prisma.$transaction([
    prisma.videoProduct.deleteMany({ where: { videoId } }),
    prisma.videoProduct.createMany({ data: products.map((p) => ({ ...p, videoId })) }),
  ]);
}
