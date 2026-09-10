import { HttpError } from './httpError';

/**
 * Client for the external image-identification service configured via
 * the AI_SEARCH env var (its base URL, no trailing slash). This is the
 * real production Cloudflare Worker (Workers AI: ResNet-50 for
 * /classify, Llama 4 Scout for /identify, Llama 3.2 3B for /describe —
 * the same worker used elsewhere for AI-powered listing generation),
 * NOT the small Express stub checked into worker/worker.js in this
 * repo. That stub is a local-dev fallback that predates this contract;
 * this client always talks to the real worker's actual routes:
 *
 *   POST {AI_SEARCH}/identify
 *     multipart/form-data, field "image" (the cropped selection, JPEG or PNG)
 *   -> 200 {
 *        success: true,
 *        description: string,       // 2-4 sentence identification
 *        suggestedTitle: string,    // short (<=70 char) listing-style name —
 *                                    // this is what we use as the search phrase,
 *                                    // since it's already cleaned/title-cased
 *                                    // and scoped to a specific product name
 *      }
 *   -> 4xx/5xx { success: false, error: string }
 *
 * There is no `labels` field in this worker's response — AiIdentification
 * only carries the single identification phrase actually returned.
 *
 * AI_SEARCH_API_KEY is still sent as a Bearer token if set, for forward
 * compatibility, but the current worker does not check it (no auth is
 * enforced server-side there today).
 */

const REQUEST_TIMEOUT_MS = 20_000;

export interface AiIdentification {
  text: string;
}

export async function identifyImage(imageBuffer: Buffer, mimeType: string): Promise<AiIdentification> {
  const endpoint = process.env.AI_SEARCH;
  if (!endpoint) {
    throw new HttpError(503, 'Visual identification is not configured (set AI_SEARCH)');
  }

  const url = `${endpoint.replace(/\/+$/, '')}/identify`;
  console.log(`[AI_SEARCH] POST ${url} — sending ${imageBuffer.length} byte ${mimeType || 'image/jpeg'} selection`);

  const form = new FormData();
  form.append('image', new Blob([imageBuffer], { type: mimeType || 'image/jpeg' }), 'selection.jpg');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  const startedAt = Date.now();
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: process.env.AI_SEARCH_API_KEY ? { Authorization: `Bearer ${process.env.AI_SEARCH_API_KEY}` } : undefined,
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error(`[AI_SEARCH] timed out after ${REQUEST_TIMEOUT_MS}ms — ${url}`);
      throw new HttpError(504, 'Image identification service timed out');
    }
    console.error(`[AI_SEARCH] request failed — ${url}:`, err instanceof Error ? err.message : err);
    throw new HttpError(502, 'Could not reach the image identification service');
  } finally {
    clearTimeout(timeout);
  }
  console.log(`[AI_SEARCH] responded ${res.status} in ${Date.now() - startedAt}ms`);

  // The worker returns { success: false, error } with an appropriate
  // status (400/413/500/etc) on failure — surface that message rather
  // than a generic one when it's present, since it's usually specific
  // (e.g. "Image too large", "No image data received").
  const data = (await res.json().catch(() => null)) as
    | { success?: boolean; description?: unknown; suggestedTitle?: unknown; error?: unknown }
    | null;

  if (!res.ok || !data || data.success === false) {
    const message = typeof data?.error === 'string' && data.error.trim() ? data.error.trim() : undefined;
    console.error(`[AI_SEARCH] identification failed: ${message || `HTTP ${res.status}`}`);
    throw new HttpError(
      res.status === 413 ? 413 : res.status === 400 ? 400 : 502,
      message || `Image identification service returned ${res.status}`
    );
  }

  // Prefer the worker's cleaned, listing-style suggestedTitle as the
  // search phrase — it's short and specific by design (see the
  // worker's IDENTIFY_PROMPT/extractSuggestedTitle). Fall back to the
  // fuller description only if a title couldn't be extracted.
  const suggestedTitle = typeof data.suggestedTitle === 'string' ? data.suggestedTitle.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  const text = suggestedTitle || description;

  if (!text) {
    console.warn('[AI_SEARCH] worker returned success but no usable text (empty suggestedTitle and description)');
    throw new HttpError(502, 'Image identification service returned no result');
  }

  console.log(
    `[AI_SEARCH] identified as "${text}"${suggestedTitle ? ' (from suggestedTitle)' : ' (from description, no suggestedTitle)'}`
  );
  return { text };
}
