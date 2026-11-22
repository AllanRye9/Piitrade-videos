export const PRODUCTION_API_BASE = 'https://api.yotweek.com';

export function resolveApiBase(configured: string | undefined, hostname?: string): string {
  const host = hostname?.toLowerCase().replace(/\.$/, '');
  if (host === 'yotweek.com' || host === 'www.yotweek.com') return PRODUCTION_API_BASE;
  return (configured ?? '').trim().replace(/\/+$/, '');
}
