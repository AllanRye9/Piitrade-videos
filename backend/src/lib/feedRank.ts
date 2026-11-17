/**
 * Personalised "For you" ranking for the main feed (GET /api/videos).
 *
 * Pure functions only (no DB access) so the scoring is unit-testable; the
 * route gathers the signals and passes them in.
 *
 * Pagination: a ranked list can't use the (createdAt, id) keyset cursor, so
 * the route ranks a bounded candidate pool of the newest videos and pages
 * through it with an offset cursor ("r<offset>"). Once the pool is used up
 * the route hands back to the normal chronological cursor, so the feed still
 * reaches every video.
 */

export const RANK_POOL_SIZE = 200;

export interface RankableVideo {
  id: string;
  createdAt: Date;
  likes: number;
  views: number;
  comments: number;
  shares: number;
  hashtags?: string[];
  uploaderSessionId?: string | null;
  locationId?: string | null;
}

export interface ViewerSignals {
  /** Video ids this session has already watched. */
  viewedIds: Set<string>;
  /** Sessions the viewer follows. */
  followingSessionIds: Set<string>;
  /** hashtag -> weight, from videos the viewer liked / saved / favourited. */
  tagWeights: Map<string, number>;
  /** uploader session -> weight, from videos the viewer liked / saved / favourited. */
  creatorWeights: Map<string, number>;
  /** The viewer's own profile location (local-first: videos from there rank higher). */
  locationId?: string | null;
  /** locationId -> weight, from videos the viewer liked / saved / favourited. */
  locationWeights: Map<string, number>;
  /** The viewer's own session (their own uploads are not boosted). */
  sessionId?: string;
}

export const EMPTY_SIGNALS: ViewerSignals = {
  viewedIds: new Set(),
  followingSessionIds: new Set(),
  tagWeights: new Map(),
  creatorWeights: new Map(),
  locationWeights: new Map(),
};

const W_FRESH = 1.0;
const W_QUALITY = 0.8;
const W_FOLLOWING = 1.2;
const W_CREATOR = 0.5;
const W_TAGS = 0.7;
const W_LOCATION = 0.6;
const VIEWED_PENALTY = 3; // pushes already-watched videos behind everything unseen

function engagement(v: RankableVideo): number {
  return v.likes * 2 + v.comments * 3 + v.shares * 4 + v.views * 0.1;
}

/** Score every video in the pool; higher = show earlier. */
export function scoreVideos(videos: RankableVideo[], signals: ViewerSignals, now: number = Date.now()): Map<string, number> {
  const maxEng = Math.max(1, ...videos.map((v) => Math.log1p(engagement(v))));
  const maxTag = Math.max(1, ...signals.tagWeights.values());
  const maxLoc = Math.max(1, ...signals.locationWeights.values());
  const maxCreator = Math.max(1, ...signals.creatorWeights.values());
  const scores = new Map<string, number>();

  for (const v of videos) {
    const ageHours = Math.max(0, (now - v.createdAt.getTime()) / 3_600_000);
    const fresh = 1 / (1 + ageHours / 24); // 1 today, 0.5 after a day, ~0.12 after a week
    const quality = Math.log1p(engagement(v)) / maxEng;

    let tagAffinity = 0;
    for (const t of v.hashtags ?? []) tagAffinity += (signals.tagWeights.get(t) ?? 0) / maxTag;
    tagAffinity = Math.min(1, tagAffinity);

    const creator = v.uploaderSessionId ?? null;
    const following = creator && signals.followingSessionIds.has(creator) ? 1 : 0;
    const creatorAffinity = creator && creator !== signals.sessionId ? (signals.creatorWeights.get(creator) ?? 0) / maxCreator : 0;

    let locAffinity = 0;
    if (v.locationId) locAffinity = v.locationId === signals.locationId ? 1 : Math.min(1, (signals.locationWeights.get(v.locationId) ?? 0) / maxLoc);

    let score = W_LOCATION * locAffinity + W_FRESH * fresh + W_QUALITY * quality + W_FOLLOWING * following + W_CREATOR * creatorAffinity + W_TAGS * tagAffinity;
    if (signals.viewedIds.has(v.id)) score -= VIEWED_PENALTY;
    scores.set(v.id, score);
  }
  return scores;
}

/**
 * Orders the pool by score (ties: newest first), then spreads out runs from
 * the same creator so one prolific uploader can't fill a whole screenful.
 */
export function rankVideos<T extends RankableVideo>(videos: T[], signals: ViewerSignals, now: number = Date.now()): T[] {
  const scores = scoreVideos(videos, signals, now);
  const sorted = [...videos].sort((a, b) => {
    const d = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);
    if (d !== 0) return d;
    const t = b.createdAt.getTime() - a.createdAt.getTime();
    return t !== 0 ? t : b.id < a.id ? -1 : 1;
  });

  // Diversify: never put the same creator back-to-back if another video is available.
  const out: T[] = [];
  const rest = [...sorted];
  while (rest.length) {
    const last = out.length ? out[out.length - 1].uploaderSessionId : null;
    let i = 0;
    if (last) {
      const j = rest.findIndex((v) => v.uploaderSessionId !== last);
      if (j > 0 && j <= 4) i = j; // only look a few places ahead so ranking stays meaningful
    }
    out.push(rest.splice(i, 1)[0]);
  }
  return out;
}

/** Offset cursor for the ranked pool: "r<offset>". */
export function encodeRankCursor(offset: number): string {
  return `r${offset}`;
}

export function decodeRankCursor(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^r\d{1,6}$/.test(raw)) return null;
  return Number(raw.slice(1));
}
