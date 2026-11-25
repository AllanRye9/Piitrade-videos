export const PRODUCTION_API_BASE = 'https://videos.piitrade.com';

/** The live site's hostnames. yotweek.com is the project's old domain; it is kept so a deployment still served there reaches the same backend. */
const PRODUCTION_HOSTS = new Set(['videos.piitrade.com', 'yotweek.com', 'www.yotweek.com']);

export function resolveApiBase(configured: string | undefined, hostname?: string): string {
  const host = hostname?.toLowerCase().replace(/\.$/, '');
  if (host && PRODUCTION_HOSTS.has(host)) return PRODUCTION_API_BASE;
  return (configured ?? '').trim().replace(/\/+$/, '');
}
