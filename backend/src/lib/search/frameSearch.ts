/**
 * "Find on Piitrade" from a screenshot of the video — the interpretation loop.
 *
 * One frame is not always enough: the product may be turned away, blurred by
 * motion, or hidden behind a hand at exactly the moment the viewer tapped. So
 * the frame at the viewer's position is tried first, and if the AI can't tell
 * what it shows — or what it names isn't listed anywhere — nearby moments are
 * tried (a second and a half either side, then three) until something is
 * interpreted AND found, or the attempts/time budget run out. Only then does
 * the caller fall back to searching by the video's own title.
 *
 * Everything that touches the outside world (ffmpeg, the AI service, the shops)
 * comes in through `FrameSearchDeps`, so the loop itself is plain logic that is
 * tested without any of them.
 */

export interface FrameRegion {
  /** Fractions of the frame, 0–1 from the top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameSearchDeps<R> {
  /** A JPEG of the video at this moment, or null when there is no frame there. */
  grabFrame: (atMs: number) => Promise<Buffer | null>;
  /** Cuts a region out of a frame (only called when the viewer marked one). */
  cropFrame: (jpeg: Buffer, region: FrameRegion) => Promise<Buffer>;
  /** What the AI says the picture shows. Throws when the service fails or times out. */
  identify: (jpeg: Buffer) => Promise<string>;
  /** Searches the shops for that description. */
  search: (query: string) => Promise<R>;
  /** How many listings a search result holds. */
  countResults: (outcome: R) => number;
  now?: () => number;
}

export interface FrameAttempt {
  atMs: number;
  /** What the AI said, when it said something. */
  identification: string | null;
  results: number;
  /** Why this attempt went no further: 'no-frame' | 'identify-failed' | 'no-results'. */
  stopped?: 'no-frame' | 'identify-failed' | 'no-results';
}

export interface FrameSearchOutcome<R> {
  attempts: FrameAttempt[];
  /** The attempt that produced listings, or the first one that at least produced a description. */
  best: { atMs: number; identification: string; outcome: R; frame: Buffer; found: boolean } | null;
}

/** Offsets from the viewer's position, in the order they are tried. */
export const FRAME_OFFSETS_MS = [0, -1500, 1500, -3000, 3000];
/** At most this many AI calls per request — the cost of one tap stays bounded. */
export const MAX_FRAME_ATTEMPTS = 3;
/** No new attempt starts after this long, so a slow AI service can't hold the request past typical proxy timeouts. */
export const FRAME_SEARCH_BUDGET_MS = 28_000;
/** Moments closer than this look the same to the AI; trying both wastes a call. */
const MIN_GAP_MS = 700;

/** Moments to sample: the viewer's own position first, then neighbours inside the video, no two nearly identical. */
export function frameTimes(atMs: number, durationMs: number | null, maxAttempts = MAX_FRAME_ATTEMPTS): number[] {
  const limit = durationMs !== null && durationMs > 0 ? Math.max(0, durationMs - 200) : Infinity;
  const clamp = (t: number) => Math.max(0, Math.min(limit, Math.round(t)));
  const out: number[] = [];
  for (const offset of FRAME_OFFSETS_MS) {
    const t = clamp(atMs + offset);
    if (out.every((u) => Math.abs(u - t) >= MIN_GAP_MS)) out.push(t);
    if (out.length >= maxAttempts) break;
  }
  return out.length ? out : [0];
}

export async function interpretFrames<R>(
  deps: FrameSearchDeps<R>,
  params: { atMs: number; durationMs: number | null; region?: FrameRegion | null; maxAttempts?: number; budgetMs?: number }
): Promise<FrameSearchOutcome<R>> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const budget = params.budgetMs ?? FRAME_SEARCH_BUDGET_MS;
  const attempts: FrameAttempt[] = [];
  let described: FrameSearchOutcome<R>['best'] = null;

  for (const atMs of frameTimes(params.atMs, params.durationMs, params.maxAttempts)) {
    if (attempts.length > 0 && now() - startedAt > budget) break;

    const frame = await deps.grabFrame(atMs);
    if (!frame) {
      attempts.push({ atMs, identification: null, results: 0, stopped: 'no-frame' });
      continue;
    }

    let identification: string;
    try {
      const picture = params.region ? await deps.cropFrame(frame, params.region) : frame;
      identification = (await deps.identify(picture)).trim();
    } catch {
      attempts.push({ atMs, identification: null, results: 0, stopped: 'identify-failed' });
      continue;
    }
    if (!identification) {
      attempts.push({ atMs, identification: null, results: 0, stopped: 'identify-failed' });
      continue;
    }

    // A search failure is not about this frame (shops down, marketplace not configured): let the caller decide.
    const outcome = await deps.search(identification);
    const count = deps.countResults(outcome);
    attempts.push({ atMs, identification, results: count, ...(count === 0 ? { stopped: 'no-results' as const } : {}) });

    if (count > 0) return { attempts, best: { atMs, identification, outcome, frame, found: true } };
    if (!described) described = { atMs, identification, outcome, frame, found: false };
  }
  return { attempts, best: described };
}
