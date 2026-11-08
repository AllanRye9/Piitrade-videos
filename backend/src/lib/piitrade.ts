/**
 * URL helpers for the public piitrade.com website.
 *
 * piitrade.com is a classifieds marketplace: buyers browse listings and
 * contact sellers there (messages / WhatsApp / merchant pages). Piitrade
 * Videos is its short-video companion and never takes an order itself —
 * every "buy" or "contact" path ends with the viewer opening the real
 * listing on piitrade.com. Confirmed against the live site: listings
 * live at /listings/<id>, search at /listings?q=<text>.
 *
 * PIITRADE_SITE_URL is the public website (NOT the API host —
 * MARKETPLACE_API is the backend that serves JSON).
 */
const DEFAULT_SITE_URL = 'https://piitrade.com';

export function siteUrl(): string {
  return (process.env.PIITRADE_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '');
}

// Lets piitrade.com's own analytics attribute visits that came from a
// video, without changing what the destination page shows.
function withAttribution(url: URL): string {
  url.searchParams.set('utm_source', 'piitrade_videos');
  url.searchParams.set('utm_medium', 'video');
  return url.toString();
}

export function listingUrl(listingId: string): string {
  return withAttribution(new URL(`${siteUrl()}/listings/${encodeURIComponent(listingId)}`));
}

export function searchUrl(query: string): string {
  const url = new URL(`${siteUrl()}/listings`);
  if (query.trim()) url.searchParams.set('q', query.trim());
  return withAttribution(url);
}
