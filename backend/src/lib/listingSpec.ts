/**
 * The open listing contract a shop implements to be searchable from Piitrade Videos:
 *
 *   GET {apiBase}/api/listings?q=<text>&sort=relevance&limit=<n>&country=<ISO>
 *   → 200 { "listings": [ { "id", "title", "price", "productImages"[{cdnUrl}] | "images"[0] }, … ] }
 *
 * Only id, title, price and an image are required; everything else is optional enrichment.
 * See docs/LISTING_SPEC.md.
 */
export interface SpecIssue {
  level: 'error' | 'warning';
  message: string;
}

export function validateListingsResponse(body: unknown): { ok: boolean; issues: SpecIssue[]; sampleCount: number } {
  const issues: SpecIssue[] = [];
  const listings = (body as any)?.listings;
  if (!Array.isArray(listings)) {
    return { ok: false, issues: [{ level: 'error', message: 'Response must be a JSON object with a "listings" array' }], sampleCount: 0 };
  }
  if (listings.length === 0) issues.push({ level: 'warning', message: 'No listings returned — the field checks below could not run' });
  listings.slice(0, 5).forEach((l: any, i: number) => {
    const at = `listings[${i}]`;
    if (l?.id === undefined || l?.id === null || l?.id === '') issues.push({ level: 'error', message: `${at}.id is required` });
    if (typeof l?.title !== 'string' || !l.title.trim()) issues.push({ level: 'error', message: `${at}.title must be a non-empty string` });
    if (l?.price === undefined || l?.price === null || (typeof l.price !== 'number' && typeof l.price !== 'string')) {
      issues.push({ level: 'error', message: `${at}.price must be a number or string` });
    }
    const img = l?.productImages?.[0]?.cdnUrl ?? l?.images?.[0];
    if (typeof img !== 'string' || !/^https?:\/\//.test(img)) issues.push({ level: 'warning', message: `${at} has no image URL (productImages[0].cdnUrl or images[0])` });
  });
  return { ok: !issues.some((i) => i.level === 'error'), issues, sampleCount: listings.length };
}
