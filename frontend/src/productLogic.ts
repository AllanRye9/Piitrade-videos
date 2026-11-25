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

export function frameRect(
  cardW: number,
  cardH: number,
  videoW: number,
  videoH: number
): Frame {
  if (!videoW || !videoH) return { left: 0, top: 0, width: cardW, height: cardH };
  const scale = Math.max(cardW / videoW, cardH / videoH);
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
