// Pure helpers (no React Native imports) so they can be unit-tested under plain Node.
// The backend mirror of activeProducts lives in backend/src/lib/shops/shoppable.ts.

export interface Timed {
  startMs: number;
  endMs: number | null;
}

/** Products whose [startMs, endMs) window contains `ms`. No endMs = until the video ends. */
export function activeProducts<T extends Timed>(products: T[], ms: number): T[] {
  return products.filter((p) => ms >= p.startMs && (p.endMs === null || p.endMs === undefined || ms < p.endMs));
}

export interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The rendered image rectangle inside the card. `cover` can extend beyond
 * the card when the source and viewport aspect ratios differ; hotspots use
 * this rectangle so they stay aligned with the cropped image.
 */
/** The most of a video's picture the feed may crop away to fill the card. */
export const MAX_CROPPED_SHARE = 0.25;

/**
 * Feed display standard: a video fills the card (cover) only when that crops little of it — a vertical clip on a
 * phone-shaped card. A landscape or square clip is shown whole (contain, with bars) instead of being zoomed until
 * most of it is cut off and what remains is enlarged and soft. Unknown size keeps the old fill behaviour.
 * Same rule as frameFit in frontend/src/features/products/productLogic.ts.
 */
export function frameFit(cardW: number, cardH: number, dims: { w: number; h: number } | null): 'cover' | 'contain' {
  if (!cardW || !cardH || !dims || !dims.w || !dims.h) return 'cover';
  const card = cardW / cardH;
  const video = dims.w / dims.h;
  const croppedShare = 1 - Math.min(card / video, video / card);
  return croppedShare <= MAX_CROPPED_SHARE ? 'cover' : 'contain';
}

export function frameRect(cardW: number, cardH: number, dims: { w: number; h: number } | null, fit: 'cover' | 'contain'): Frame {
  if (!dims || !dims.w || !dims.h) return { left: 0, top: 0, width: cardW, height: cardH };
  const scale = fit === 'cover'
    ? Math.max(cardW / dims.w, cardH / dims.h)
    : Math.min(cardW / dims.w, cardH / dims.h);
  const width = dims.w * scale;
  const height = dims.h * scale;
  return { left: (cardW - width) / 2, top: (cardH - height) / 2, width, height };
}

/** Extracts a video id from piitrade://v/<id>, https://<web host>/v/<id> or /embed/<id>. Anything else → null. */
export function parseVideoLink(url: string | null | undefined, webUrl: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const isApp = u.protocol === 'piitrade:';
    const isWeb = (u.protocol === 'https:' || u.protocol === 'http:') && u.host === new URL(webUrl).host;
    if (!isApp && !isWeb) return null;
    // piitrade://v/<id> parses with host "v"; https://host/v/<id> has pathname "/v/<id>".
    const path = isApp ? `/${u.host}${u.pathname}` : u.pathname;
    const m = path.match(/^\/(?:v|embed)\/([^/?#]+)\/?$/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

export function embedSnippet(videoId: string, webUrl: string): string {
  return `<iframe src="${webUrl}/embed/${encodeURIComponent(videoId)}" width="360" height="640" style="border:0;max-width:100%" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
}

/** Clamp + format a seconds value for the tagging UI ("0:07"). */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
