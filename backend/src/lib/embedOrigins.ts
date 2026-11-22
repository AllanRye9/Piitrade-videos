import { HttpError } from './httpError';

export interface ShopEmbedRule {
  baseUrl: string;
  embedOrigins: string;
}

type FrameSource = "'self'" | string;

function normalizeSource(raw: string): string | null {
  const value = raw.trim();
  if (value === "'self'") return value;
  const wildcard = value.match(/^(https?):\/\/\*\.([^/:?#]+)(?::(\d+))?$/i);
  if (wildcard) {
    try {
      const origin = new URL(`${wildcard[1]}://${wildcard[2]}${wildcard[3] ? `:${wildcard[3]}` : ''}`);
      return `${origin.protocol}//*.${origin.host}`;
    } catch {
      return null;
    }
  }

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function splitSources(raw: string): string[] {
  return raw.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean);
}

function baseOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function normalizeOriginsInput(input: unknown): string {
  if (input === undefined || input === null || input === '') return '';
  if (typeof input !== 'string') throw new HttpError(400, 'Allowed embed sites must be a string');
  const tokens = splitSources(input);
  const normalized = tokens.map(normalizeSource);
  if (normalized.some((source) => source === null)) {
    throw new HttpError(400, 'Allowed embed sites must be http(s) origins without paths');
  }
  return [...new Set(normalized as string[])].join('\n');
}

function isWildcard(source: string): boolean {
  return source.includes('://*.');
}

function wildcardMatches(source: string, origin: string): boolean {
  if (!isWildcard(source)) return false;
  const [scheme, hostPattern] = source.split('://');
  const url = new URL(origin);
  if (`${scheme}:` !== url.protocol) return false;
  const suffix = hostPattern.slice(2).toLowerCase();
  const host = url.host.toLowerCase();
  return host.endsWith(`.${suffix}`) && host !== suffix;
}

function narrowerSource(a: string, b: string): string | null {
  if (a === b) return a;
  if (a === "'self'" || b === "'self'") return null;
  if (isWildcard(a) && !isWildcard(b)) return wildcardMatches(a, b) ? b : null;
  if (!isWildcard(a) && isWildcard(b)) return wildcardMatches(b, a) ? a : null;
  if (isWildcard(a) && isWildcard(b)) {
    const aSuffix = a.split('://*.')[1].toLowerCase();
    const bSuffix = b.split('://*.')[1].toLowerCase();
    if (a.startsWith(b.split('://*.')[0]) && aSuffix.endsWith(`.${bSuffix}`)) return a;
    if (a.startsWith(b.split('://*.')[0]) && bSuffix.endsWith(`.${aSuffix}`)) return b;
  }
  return null;
}

function intersect(current: Set<FrameSource> | null, next: Set<FrameSource>): Set<FrameSource> {
  if (current === null) return next;
  const result = new Set<FrameSource>();
  for (const a of current) {
    for (const b of next) {
      const narrower = narrowerSource(a, b);
      if (narrower) result.add(narrower);
    }
  }
  return result;
}

export function resolveFrameAncestors(globalInput: string | undefined, rules: ShopEmbedRule[]): string {
  let allowed: Set<FrameSource> | null = null;
  const globalValue = globalInput?.trim() ?? '';

  if (globalValue && globalValue !== '*') {
    const sources = splitSources(globalValue).map(normalizeSource).filter((source): source is string => source !== null);
    allowed = new Set(sources.length ? sources : ["'self'"]);
  }

  for (const rule of rules) {
    if (!rule.embedOrigins.trim()) continue;
    const sources = splitSources(rule.embedOrigins).map(normalizeSource).filter((source): source is string => source !== null);
    const shopAllowed = new Set<FrameSource>(["'self'"]);
    const ownOrigin = baseOrigin(rule.baseUrl);
    if (ownOrigin) shopAllowed.add(ownOrigin);
    for (const source of sources) shopAllowed.add(source);
    allowed = intersect(allowed, shopAllowed);
  }

  if (allowed === null) return '*';
  if (allowed.size === 0) return "'none'";
  return [...allowed].join(' ');
}
