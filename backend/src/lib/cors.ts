import type { CorsOptions } from 'cors';

const REQUIRED_ORIGINS = [
  'https://videos.piitrade.com',
  'https://v.piitrade.com',
  'https://yotweek.com',
  'https://www.yotweek.com',
  'https://piitrade.com',
  'https://www.piitrade.com',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost',
];

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:', 'capacitor:', 'ionic:'].includes(url.protocol)) return null;
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin === 'null' ? `${url.protocol}//${url.host}` : url.origin;
  } catch {
    return null;
  }
}

function localDevelopmentOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  } catch {
    return false;
  }
}

function codespacesPreviewOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.hostname.endsWith('.app.github.dev');
  } catch {
    return false;
  }
}

export function corsOptions(): CorsOptions {
  const configured = process.env.ALLOWED_ORIGIN;
  if (!configured?.trim()) {
    return {
      origin(_origin, callback) {
        callback(null, true);
      },
      maxAge: 86_400,
    };
  }

  const allowed = new Set(REQUIRED_ORIGINS);
  for (const raw of configured.split(',')) {
    const origin = normalizeOrigin(raw);
    if (origin) allowed.add(origin);
  }

  return {
    origin(origin, callback) {
      callback(null, !origin || allowed.has(origin) || localDevelopmentOrigin(origin) || codespacesPreviewOrigin(origin));
    },
    maxAge: 86_400,
  };
}
