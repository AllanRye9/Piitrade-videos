// worker.js — the identification AI service.
//
// This is a small, standalone Express server that exposes a single
// endpoint, POST /identify, matching the contract the backend expects
// from the AI_SEARCH env var (see backend/src/lib/aiSearch.ts):
//
//   POST /identify   multipart/form-data, field "image"
//   -> 200 { "text": "<short identification>", "labels": string[] }
//
// It runs as its own process/container on purpose, not inside the main
// backend: identifying an image is a separate concern from serving the
// video feed, it needs its own API key (ANTHROPIC_API_KEY) and its own
// timeout/scaling profile, and keeping it separate means it can be
// swapped for a different vision model or provider without touching
// the backend at all — only AI_SEARCH's URL needs to change.

const express = require('express');
const multer = require('multer');

const PORT = Number(process.env.PORT) || 8787;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const WORKER_AUTH_TOKEN = process.env.WORKER_AUTH_TOKEN; // optional shared secret with the backend
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      cb(new Error('Only image files are accepted'));
      return;
    }
    cb(null, true);
  },
});

const app = express();

app.get('/health', (_req, res) => res.json({ ok: true }));

function checkWorkerAuth(req, res, next) {
  // Optional shared-secret check. The backend sends this as a Bearer
  // token when AI_SEARCH_API_KEY is set on its side — if this worker
  // also has WORKER_AUTH_TOKEN set, the two must match, so an attacker
  // who finds this service's URL can't spend API credits on our key.
  if (WORKER_AUTH_TOKEN) {
    const header = req.header('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token !== WORKER_AUTH_TOKEN) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }
  next();
}

app.post('/identify', checkWorkerAuth, upload.single('image'), async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    res.status(503).json({ error: 'Identification service is not configured (ANTHROPIC_API_KEY is unset)' });
    return;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No image uploaded (expected multipart field "image")' });
    return;
  }

  const base64 = file.buffer.toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: file.mimetype, data: base64 },
              },
              {
                type: 'text',
                text:
                  'Identify the single product or item that the marked/cropped region of this image shows, ' +
                  'as if you were writing a short marketplace search query for it. Respond with ONLY raw JSON ' +
                  '(no markdown fences, no commentary) in exactly this shape: ' +
                  '{"text": "<3-6 word search phrase for the item>", "labels": ["<alt keyword>", ...]}. ' +
                  'Use at most 5 labels. If nothing identifiable is visible, respond with ' +
                  '{"text": "", "labels": []}.',
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('Anthropic API error', response.status, detail);
      res.status(502).json({ error: `Identification model returned ${response.status}` });
      return;
    }

    const data = await response.json();
    const textBlock = Array.isArray(data.content) ? data.content.find((b) => b.type === 'text') : null;
    const raw = textBlock && typeof textBlock.text === 'string' ? textBlock.text.trim() : '';

    const parsed = parseIdentification(raw);
    if (!parsed || !parsed.text) {
      res.status(422).json({ error: 'Could not identify anything in the selected region' });
      return;
    }

    res.json(parsed);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      res.status(504).json({ error: 'Identification model timed out' });
      return;
    }
    console.error('Identification failed', err);
    res.status(502).json({ error: 'Identification request failed' });
  } finally {
    clearTimeout(timeout);
  }
});

// The model is asked for raw JSON, but is treated as untrusted text:
// strip any accidental code-fence wrapping, then parse defensively.
function parseIdentification(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    const text = typeof obj.text === 'string' ? obj.text.trim() : '';
    const labels = Array.isArray(obj.labels) ? obj.labels.filter((l) => typeof l === 'string') : [];
    return { text, labels };
  } catch {
    // Model didn't return valid JSON — fall back to using the raw
    // trimmed text itself as the identification, rather than failing
    // the whole request over a formatting slip.
    return { text: cleaned, labels: [] };
  }
}

// Centralized error handler — mainly for multer errors (oversized/
// wrong-type uploads), which multer surfaces via `next(err)`.
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message });
    return;
  }
  if (err) {
    res.status(400).json({ error: err.message || 'Bad request' });
    return;
  }
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Identification worker listening on port ${PORT}`);
});
