import { HttpError } from './httpError';

/**
 * Client for the external image-identification service configured via
 * the AI_SEARCH env var (its base URL). That service is the `worker/`
 * app in this repo (see worker/worker.js) — a small standalone service
 * that wraps a vision model — but AI_SEARCH can point at any service
 * that implements the same contract:
 *
 *   POST {AI_SEARCH}
 *     multipart/form-data, field "image" (the cropped selection, JPEG or PNG)
 *   -> 200 { "text": "<short identification of the item>", "labels"?: string[] }
 *
 * Optional AI_SEARCH_API_KEY is sent as a Bearer token if set.
 */

const REQUEST_TIMEOUT_MS = 20_000;

export interface AiIdentification {
  text: string;
  labels?: string[];
}

export async function identifyImage(imageBuffer: Buffer, mimeType: string): Promise<AiIdentification> {
  const endpoint = process.env.AI_SEARCH;
  if (!endpoint) {
    throw new HttpError(503, 'Visual identification is not configured (set AI_SEARCH)');
  }

  const form = new FormData();
  form.append('image', new Blob([imageBuffer], { type: mimeType || 'image/jpeg' }), 'selection.jpg');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: process.env.AI_SEARCH_API_KEY ? { Authorization: `Bearer ${process.env.AI_SEARCH_API_KEY}` } : undefined,
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new HttpError(504, 'Image identification service timed out');
    }
    throw new HttpError(502, 'Could not reach the image identification service');
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new HttpError(502, `Image identification service returned ${res.status}`);
  }

  const data = (await res.json().catch(() => null)) as { text?: unknown; labels?: unknown } | null;
  if (!data || typeof data.text !== 'string' || !data.text.trim()) {
    throw new HttpError(502, 'Image identification service returned no result');
  }

  return {
    text: data.text.trim(),
    labels: Array.isArray(data.labels) ? data.labels.filter((l): l is string => typeof l === 'string') : undefined,
  };
}
