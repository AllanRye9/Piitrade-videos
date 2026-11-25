// Pure (no React Native imports) so it can be unit-tested under plain Node.

/** The fields the backend puts in a JSON error body (see HttpError in backend/src/index.ts). */
export interface ErrorFields {
  error?: string;
  message?: string;
  code?: string;
  duration?: number;
  maxSeconds?: number;
}

/** Parses an error body. Returns null when it isn't a JSON object (an HTML error page, an empty body, …). */
export function parseErrorBody(text: string | null | undefined): ErrorFields | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    return {
      error: typeof v.error === 'string' ? v.error : undefined,
      message: typeof v.message === 'string' ? v.message : undefined,
      code: typeof v.code === 'string' ? v.code : undefined,
      duration: typeof v.duration === 'number' ? v.duration : undefined,
      maxSeconds: typeof v.maxSeconds === 'number' ? v.maxSeconds : undefined,
    };
  } catch {
    return null;
  }
}

/** A web page (a proxy's 404, a hosting provider's placeholder, the website's index.html) rather than API output. */
export function looksLikeHtml(text: string | null | undefined): boolean {
  return /^\s*<(!doctype|html|head|body)/i.test(text ?? '');
}

/** "v.piitrade.com" from "https://v.piitrade.com". */
export function hostLabel(base: string): string {
  return base.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/.*$/, '') || base;
}

/**
 * One readable line for a failed request, naming the cause instead of just a status number.
 * The server's own message always wins. Without one, a 404 that is not JSON means the request reached a
 * server that doesn't run this API (wrong or stale address, or /api not routed to the backend) — say so,
 * with the address, because that is the one mistake the person (or the build) can actually fix.
 */
export function describeHttpFailure(input: { method: string; path: string; status: number; base: string; body: string | null | undefined }): { message: string; fields: ErrorFields | null } {
  const { method, path, status, base, body } = input;
  const fields = parseErrorBody(body);
  const serverMsg = fields?.error ?? fields?.message;
  const host = hostLabel(base);
  let detail: string;
  if (serverMsg) detail = serverMsg;
  else if (status === 404) detail = `HTTP 404 — ${host} has no such endpoint. The app may be pointed at the wrong server.`;
  else if (status === 502 || status === 503 || status === 504) detail = `HTTP ${status} — the server at ${host} is unavailable or restarting. Try again in a moment.`;
  else if (looksLikeHtml(body)) detail = `HTTP ${status} — ${host} answered with a web page instead of the API.`;
  else detail = `HTTP ${status} (${host})`;
  return { message: `${method} ${path}: ${detail}`, fields };
}

/** Message for a 2xx answer that wasn't JSON — typically the website's index.html served because /api isn't routed to the backend. */
export function describeBadSuccessBody(input: { method: string; path: string; status: number; base: string; body: string | null | undefined }): string {
  const { method, path, status, base, body } = input;
  const host = hostLabel(base);
  return looksLikeHtml(body)
    ? `${method} ${path}: ${host} returned a web page instead of API data (HTTP ${status}). /api is not routed to the backend there.`
    : `${method} ${path} returned HTTP ${status} with an invalid JSON response from ${host}`;
}
