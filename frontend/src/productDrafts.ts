import type { OwnProduct, ProductPayload, ProductSuggestion } from './types';

/** One row in the product editor. Times are typed in seconds (e.g. "2.5"), stored as milliseconds. */
export interface ProductDraft {
  key: string;
  siteId: string;
  url: string;
  title: string;
  start: string;
  end: string;
  x: number | null;
  y: number | null;
}

export const MAX_PRODUCTS = 8;

/** Where on the frame a product's button sits. "auto" stacks it with the caption. */
export const POSITIONS: Array<{ id: string; label: string; x: number | null; y: number | null }> = [
  { id: 'auto', label: 'Under the caption', x: null, y: null },
  { id: 'tl', label: 'Top left', x: 0.22, y: 0.18 },
  { id: 'tr', label: 'Top right', x: 0.78, y: 0.18 },
  { id: 'ml', label: 'Middle left', x: 0.22, y: 0.5 },
  { id: 'mc', label: 'Middle', x: 0.5, y: 0.5 },
  { id: 'mr', label: 'Middle right', x: 0.78, y: 0.5 },
  { id: 'bl', label: 'Lower left', x: 0.22, y: 0.72 },
  { id: 'br', label: 'Lower right', x: 0.78, y: 0.72 },
];

export function positionIdOf(d: Pick<ProductDraft, 'x' | 'y'>): string {
  if (d.x == null || d.y == null) return 'auto';
  return POSITIONS.find((p) => p.x === d.x && p.y === d.y)?.id ?? 'custom';
}

let counter = 0;
export function newDraft(partial: Partial<ProductDraft> = {}): ProductDraft {
  return { key: `d${Date.now()}-${counter++}`, siteId: '', url: '', title: '', start: '', end: '', x: null, y: null, ...partial };
}

/** "2.5" → 2500. Blank → null. Throws a readable message for anything else. */
export function parseSeconds(text: string, label: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a number of seconds, like 2.5`);
  return Math.round(n * 1000);
}

export function secondsText(ms: number | null | undefined): string {
  if (ms == null) return '';
  const s = ms / 1000;
  return Number.isInteger(s) ? String(s) : s.toFixed(1);
}

export function draftsFromOwn(products: OwnProduct[]): ProductDraft[] {
  return products.map((p) => newDraft({ siteId: p.siteId, url: p.url, title: p.title ?? '', start: p.startMs ? secondsText(p.startMs) : '', end: secondsText(p.endMs), x: p.x, y: p.y }));
}

export function draftFromSuggestion(s: ProductSuggestion, candidateIndex = 0, siteIdBySlug: Record<string, string> = {}): ProductDraft {
  const c = s.candidates[candidateIndex] ?? s.candidates[0];
  return newDraft({ siteId: (c.site && siteIdBySlug[c.site]) || '', url: c.url, title: '', start: secondsText(s.startMs), end: secondsText(s.endMs) });
}

/** Rows with a link become the payload the server validates. Rows left blank are ignored. Throws a readable message on bad times. */
export function draftsToPayload(drafts: ProductDraft[]): ProductPayload[] {
  const out: ProductPayload[] = [];
  drafts.forEach((d, i) => {
    const url = d.url.trim();
    if (!url) return;
    const n = i + 1;
    const startMs = parseSeconds(d.start, `Product ${n}: start`) ?? 0;
    const endMs = parseSeconds(d.end, `Product ${n}: end`);
    if (endMs != null && endMs <= startMs) throw new Error(`Product ${n}: the end must be after the start`);
    out.push({ siteId: d.siteId || undefined, url, title: d.title.trim() || undefined, startMs, endMs, x: d.x, y: d.y });
  });
  return out;
}

/** The products visible at `nowMs`. */
export function activeAt<T extends { startMs: number; endMs: number | null }>(products: T[], nowMs: number): T[] {
  return products.filter((p) => nowMs >= p.startMs && (p.endMs == null || nowMs < p.endMs));
}
