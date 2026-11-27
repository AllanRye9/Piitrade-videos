const HASHTAG_PATTERN = /#([a-z0-9_]{1,30})/gi;
const MAX_HASHTAGS_PER_VIDEO = 10;

/**
 * Pulls hashtags out of free text (a video's title + description)
 * rather than requiring a separate tagging UI at upload — this is the
 * TikTok/Instagram convention (type #shoes inline in your caption) and
 * means zero new upload-form fields were needed for this feature.
 * Lowercased and deduped; capped at MAX_HASHTAGS_PER_VIDEO so a
 * caption can't be turned into a hashtag-stuffing spam vector.
 */
export function extractHashtags(...texts: (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(HASHTAG_PATTERN)) {
      found.add(match[1].toLowerCase());
      if (found.size >= MAX_HASHTAGS_PER_VIDEO) return [...found];
    }
  }
  return [...found];
}
