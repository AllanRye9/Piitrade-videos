/** Public info about who uploaded a video — absent for videos with no
 *  (or no longer discoverable) uploader. See /u/:handle (AccountPage). */
export interface VideoUploader {
  handle: string;
  displayName: string | null;
  avatar: string | null;
}

export interface Video {
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
  /** The connected marketplace/store this video promotes, if any. */
  site?: { slug: string; name: string; url: string } | null;
  /** The exact product page the creator linked (always on that site). */
  product?: { url: string; title: string | null } | null;
  /** Every product pinned to the video, in display order. Open `go` (relative to the site root) so the tap is tracked. */
  products?: VideoProductPin[];
}

/** A product pinned to a video, shown from startMs until endMs (null = until the end), optionally at a spot on the frame. */
export interface VideoProductPin {
  id: string;
  title: string | null;
  /** Direct link to the product page: a fallback only. */
  url: string;
  site: { slug: string; name: string } | null;
  /** Tracked link, e.g. /go/<videoId>/<productId>. */
  go: string;
  startMs: number;
  endMs: number | null;
  /** Position on the frame as fractions 0..1, when the creator placed it. */
  x: number | null;
  y: number | null;
}

/** What the apps send when saving products. */
export interface ProductPayload {
  siteId?: string;
  url: string;
  title?: string;
  startMs?: number;
  endMs?: number | null;
  x?: number | null;
  y?: number | null;
}

/** A product on one of your own videos, as stored. */
export interface OwnProduct {
  id: string;
  siteId: string;
  url: string;
  title: string | null;
  startMs: number;
  endMs: number | null;
  x: number | null;
  y: number | null;
}

/** An AI suggestion from looking at a few frames of your video. */
export interface ProductSuggestion {
  query: string;
  startMs: number;
  endMs: number;
  candidates: Array<{ title: string; url: string; image: string; price: string; site: string | null }>;
}

/** A creator's earnings ledger. Amounts are minor units (cents) per currency. */
export interface Earnings {
  balances: Record<string, { pending: number; approved: number; paid: number }>;
  clicksLast30Days: number;
  recent: Array<{ id: string; video: string; site: string; currency: string; saleMinor: number; commissionMinor: number; status: 'pending' | 'approved' | 'paid' | 'reversed'; createdAt: string }>;
  rates: Array<{ site: string; commissionPct: number }>;
}

/** A connected marketplace/store (Admin → Sites), with ready-made links. */
export interface SiteInfo {
  id: string;
  slug: string;
  name: string;
  country: string;
  url: string;
  homeUrl: string;
  browseUrl: string;
  sellUrl: string | null;
  /** Whether "Find products" can show live listings from it (vs. only linking to its search). */
  searchable: boolean;
}

/** What one site contributed to a product search. */
export interface SiteSearchSummary {
  slug: string;
  name: string;
  /** "See all on <site>" for the query that matched. */
  browseUrl: string;
  count: number;
  linkOnly: boolean;
  error?: string;
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

/** One result card in the "Find products" sheet — a listing from one of the
 *  connected sites (or, for the local demo-catalog fallback, a stand-in that
 *  links to a site search). There is nothing to add to a cart or check out:
 *  the card just opens the listing on its site. */
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
  /** Opens this listing on its site. */
  listingUrl: string;
  /** Which connected site it came from. */
  site?: { slug: string; name: string };
  location?: string;
  condition?: string;
  sellerName?: string;
  storeName?: string;
  verifiedSeller?: boolean;
  featured?: boolean;
  /** Only present for the local perceptual-hash fallback, where it's a real similarity score. */
  match?: number;
}

/** Response of both visual search and typed marketplace search. */
export interface MarketplaceSearchResponse {
  results: VisualSearchResult[];
  identification?: string;
  matchedQuery?: string | null;
  /** "See all results" on the first site with matches. */
  browseUrl?: string;
  /** Per-site breakdown with a "See all" link for each. */
  sites?: SiteSearchSummary[];
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
