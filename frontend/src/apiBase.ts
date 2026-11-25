export const PRODUCTION_API_BASE = 'https://v.piitrade.com';

export function resolveApiBase(configured: string | undefined, hostname?: string): string {
  const host = hostname?.toLowerCase().replace(/\.$/, '');
  if (host === 'videos.piitrade.com') return PRODUCTION_API_BASE;
  return (configured ?? '').trim().replace(/\/+$/, '');
}
