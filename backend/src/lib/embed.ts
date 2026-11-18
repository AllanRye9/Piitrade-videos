/** Pure helpers for the embed/oEmbed endpoints — unit-tested in test/embed.test.js. */

export const EMBED_DEFAULT_WIDTH = 360;
export const EMBED_MAX_WIDTH = 600;
const RATIO = 16 / 9; // portrait video: height = width * 16/9

/** Player size for an oEmbed request, honouring maxwidth / maxheight (never larger than asked). */
export function oembedSize(maxWidth?: number, maxHeight?: number): { width: number; height: number } {
  let width = Math.min(EMBED_MAX_WIDTH, Math.max(120, Math.trunc(maxWidth || EMBED_DEFAULT_WIDTH)));
  let height = Math.round(width * RATIO);
  if (maxHeight && maxHeight > 0 && height > maxHeight) {
    height = Math.max(160, Math.trunc(maxHeight));
    width = Math.round(height / RATIO);
  }
  return { width, height };
}

/** The video id in a /v/:id or /embed/:id link, if it points at one of `origins`; otherwise null. */
export function parseVideoUrl(raw: string, origins: string[]): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const hosts = origins
    .filter(Boolean)
    .map((o) => {
      try {
        return new URL(o).host.toLowerCase();
      } catch {
        return '';
      }
    })
    .filter(Boolean);
  if (!hosts.includes(url.host.toLowerCase())) return null;
  const m = /^\/(?:v|embed)\/([^/]+)\/?$/.exec(url.pathname);
  return m ? decodeURIComponent(m[1]) : null;
}
