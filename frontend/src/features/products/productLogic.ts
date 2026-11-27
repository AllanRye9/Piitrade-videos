export interface TimedProduct {
  id: string;
  startMs: number;
  endMs: number | null;
  x: number | null;
  y: number | null;
}

export interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function activeProducts<T extends Pick<TimedProduct, 'startMs' | 'endMs'>>(products: T[], ms: number): T[] {
  return products.filter((p) => ms >= p.startMs && (p.endMs === null || ms < p.endMs));
}

export type FrameFit = 'cover' | 'contain';

/** The most of a video's picture the feed may crop away to fill the card. */
export const MAX_CROPPED_SHARE = 0.25;

/**
 * Feed display standard: a video fills the card (cover) only when that crops little of it — a vertical clip on a
 * phone-shaped card. A landscape or square clip is shown whole (contain, with bars) instead of being zoomed until
 * most of it is cut off and what remains is enlarged and soft. Unknown size keeps the old fill behaviour.
 * Same rule in mobile/src/lib/productLogic.ts (tests/web-mobile-parity.test.mjs keeps them equal).
 */
export function frameFit(cardW: number, cardH: number, videoW: number, videoH: number): FrameFit {
  if (!cardW || !cardH || !videoW || !videoH) return 'cover';
  const card = cardW / cardH;
  const video = videoW / videoH;
  const croppedShare = 1 - Math.min(card / video, video / card);
  return croppedShare <= MAX_CROPPED_SHARE ? 'cover' : 'contain';
}

export function frameRect(
  cardW: number,
  cardH: number,
  videoW: number,
  videoH: number,
  fit: FrameFit = 'cover'
): Frame {
  if (!videoW || !videoH) return { left: 0, top: 0, width: cardW, height: cardH };
  const scale = fit === 'cover' ? Math.max(cardW / videoW, cardH / videoH) : Math.min(cardW / videoW, cardH / videoH);
  const width = videoW * scale;
  const height = videoH * scale;
  return { left: (cardW - width) / 2, top: (cardH - height) / 2, width, height };
}

export function isDockedProduct(product: Pick<TimedProduct, 'x' | 'y'>): boolean {
  return product.x === null || product.y === null;
}

export function productPosition(
  product: Pick<TimedProduct, 'x' | 'y'>,
  frame: Frame
): { left: number; top: number } | null {
  if (product.x === null || product.y === null) return null;
  return { left: frame.left + product.x * frame.width, top: frame.top + product.y * frame.height };
}
