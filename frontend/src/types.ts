/** Public info about who uploaded a video — absent for videos with no
 *  (or no longer discoverable) uploader. See /u/:handle (AccountPage). */
export interface VideoUploader {
  handle: string;
  displayName: string | null;
  avatar: string | null;
  /** The signed-in viewer is this creator. */
  isOwn?: boolean;
}

/** A shop product pinned to a video. Taps go through the attribution redirect, so no destination URL is exposed here. */
export interface VideoProduct {
  id: string;
  title: string;
  /** Shop name, e.g. "Piitrade". */
  site: string;
  /** Shop host, e.g. "piitrade.com". */
  host: string;
  startMs: number;
  /** null = until the video ends. */
  endMs: number | null;
  /** Hotspot as 0..1 fractions of the picture; null = docked above the caption. */
  x: number | null;
  y: number | null;
  /** The viewer already saved this product. */
  saved?: boolean;
}

/** A product pin as a creator edits it (includes the destination link). */
export interface ProductPin {
  url: string;
  title: string;
  startMs: number;
  endMs: number | null;
  x?: number | null;
  y?: number | null;
}

export interface ProductSuggestion {
  /** Which connected shop the match is from. */
  shop?: string;
  title: string;
  url: string;
  image: string;
  price: string;
  startMs: number;
  endMs: number;
}

export interface SiteInfo {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
  country: string;
  currency: string;
}

/** One entry in the viewer's Saved items list. */
export interface SavedItem {
  id: string;
  title: string;
  url: string;
  host: string;
  site: string;
  videoId: string | null;
  videoTitle: string | null;
  poster: string | null;
  createdAt: string;
}

export interface Video {
  /** Products pinned to this video (empty/absent for older videos). */
  products?: VideoProduct[];
  id: string;
  title: string;
  description: string;
  url: string;
  poster: string | null;
  duration: number | null;
  likes: number;
  views: number;
  comments: number;
  shares: number;
  hashtags: string[];
  createdAt: string;
  liked: boolean;
  favorited: boolean;
  saved: boolean;
  uploader?: VideoUploader | null;
}

/** Summary shown on the discover list and at the top of a public
 *  /u/:handle profile page. */
export interface AccountSummary {
  handle: string;
  displayName: string | null;
  avatar: string | null;
  bio: string | null;
  videoCount: number;
  totalLikes: number;
  followersCount: number;
  /** Only present on the single-account page (GET /api/accounts/:handle) —
   *  omitted on the discover list, where it isn't worth a query per row. */
  followingCount?: number;
  isFollowing?: boolean;
}

export interface Comment {
  id: string;
  videoId: string;
  author: string;
  text: string;
  createdAt: string;
  likes: number;
  liked: boolean;
  /** Present on top-level comments (GET /:id/comments) — omitted on
   *  replies themselves, since a reply can't have its own replies
   *  (threading is flattened to one level — see the backend). */
  replyCount?: number;
}

/** One result card in the "Find on Piitrade" sheet — a classifieds
 *  listing from piitrade.com (or, for the local demo-catalog fallback,
 *  a stand-in that links to a piitrade.com search). There is nothing
 *  to add to a cart or check out: piitrade.com is a classifieds site,
 *  so the card just opens the listing there. */
export interface VisualSearchResult {
  id: string;
  name: string;
  /** Display price, e.g. "UGX 800,000". */
  price: string;
  /** Display original price when the seller has reduced it. */
  originalPrice?: string;
  category: string;
  image: string;
  description?: string;
  /** Opens this listing on piitrade.com. */
  listingUrl: string;
  location?: string;
  condition?: string;
  sellerName?: string;
  storeName?: string;
  verifiedSeller?: boolean;
  featured?: boolean;
  /** Which connected shop the listing is from (absent for the demo catalog). */
  shop?: { id: string; name: string };
  /** Only present for the local perceptual-hash fallback, where it's a real similarity score. */
  match?: number;
}

/** Response of both visual search and typed marketplace search. */
export interface MarketplaceSearchResponse {
  results: VisualSearchResult[];
  identification?: string;
  matchedQuery?: string | null;
  /** "See all results" on piitrade.com. */
  browseUrl?: string;
  /** Which connected shops were searched and which could not be reached this time. */
  shops?: { searched: Array<{ id: string; name: string; count: number }>; failed: Array<{ id: string; name: string }> };
}

export interface AppNotification {
  id: string;
  type: 'follow' | 'comment';
  read: boolean;
  createdAt: string;
  commentText: string | null;
  actor: { handle: string | null; displayName: string | null; avatar: string | null };
  video: { id: string; title: string; poster: string | null } | null;
}

export interface TrendingHashtag {
  tag: string;
  count: number;
}

/** The partner application form (POST /api/partners/apply). */
export interface PartnerApplicationForm {
  name: string;
  baseUrl: string;
  apiBase: string;
  contactEmail: string;
  contactName?: string;
  country?: string;
  currency?: string;
  notes?: string;
}

export interface PartnerApplicationStatus {
  id: string;
  name: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewNote: string;
  createdAt: string;
  reviewedAt: string | null;
}

/** Result of the server's check of a partner's listing API against docs/LISTING_SPEC.md. */
export interface PartnerApiCheck {
  ok: boolean;
  status?: number;
  ms: number;
  issues: Array<{ level: 'error' | 'warning'; message: string }>;
  sampleCount?: number;
}

/** GET /api/config — admin-managed settings the app reads at start-up (see backend/src/lib/settings.ts). */
export interface SiteConfig {
  guestPrompt: { enabled: boolean; firstAfterSeconds: number; baseGapSeconds: number; backoff: number; maxPerSession: number; autoHideSeconds: number };
  maintenance: { enabled: boolean; message: string };
  announcement: { enabled: boolean; text: string; link: string; level: 'info' | 'success' | 'warning'; version: string };
  features: { signups: boolean; uploads: boolean; comments: boolean; partnerApplications: boolean };
  app: { minVersion: string; latestVersion: string; updateUrl: string; updateMessage: string };
}
