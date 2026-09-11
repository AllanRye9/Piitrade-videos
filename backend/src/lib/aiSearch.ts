import { HttpError } from './httpError';

/**
 * Client for the external image-identification service configured via
 * the AI_SEARCH env var (its base URL, no trailing slash). This is the
 * real production Cloudflare Worker (Workers AI: ResNet-50 for
 * /classify, Llama 4 Scout for /identify, Llama 3.2 3B for /describe).
 *
 *   POST {AI_SEARCH}/identify
 *     multipart/form-data, field "image" (the cropped selection, JPEG or PNG)
 *   -> 200 {
 *        success: true,
 *        description: string,
 *        suggestedTitle: string,
 *      }
 *   -> 4xx/5xx { success: false, error: string }
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
      headers: process.env.AI_SEARCH_API_KEY
        ? { Authorization: `Bearer ${process.env.AI_SEARCH_API_KEY}` }
        : undefined,
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

  const data = (await res.json().catch(() => null)) as
    | { success?: boolean; description?: unknown; suggestedTitle?: unknown; error?: unknown }
    | null;

  // ---- FIX: preserve the worker's actual status code on failure ----
  // The worker returns 400/413/500 with { success:false, error }.
  // Previously every non-400/413 status was squashed to 502, hiding
  // real 5xx errors from the worker as "bad gateway" errors.
  if (!res.ok || !data || data.success === false) {
    const message =
      typeof data?.error === 'string' && data.error.trim()
        ? data.error.trim()
        : `Image identification service returned ${res.status}`;

    console.error(`[AI_SEARCH] identification failed (${res.status}): ${message}`);

    // Pass through the worker's status if it's a meaningful client/server
    // error (4xx/5xx). Map anything weird (3xx, 1xx, 0) to 502.
    const status =
      res.status >= 400 && res.status < 600 ? res.status : 502;

    throw new HttpError(status, message);
  }

  // ---- FIX: guard against a 200 response that still lacks success:true ----
  if (data.success !== true) {
    console.error(`[AI_SEARCH] worker returned HTTP 200 but success !== true`);
    throw new HttpError(502, 'Image identification service returned an unexpected response');
  }

  const suggestedTitle =
    typeof data.suggestedTitle === 'string' ? data.suggestedTitle.trim() : '';
  const description =
    typeof data.description === 'string' ? data.description.trim() : '';
  const text = suggestedTitle || description;

  if (!text) {
    console.warn('[AI_SEARCH] worker returned success but no usable text (empty suggestedTitle and description)');
    throw new HttpError(502, 'Image identification service returned no result');
  }

  console.log(
    `[AI_SEARCH] identified as "${text}"${
      suggestedTitle ? ' (from suggestedTitle)' : ' (from description, no suggestedTitle)'
    }`
  );
  return { text };
}
