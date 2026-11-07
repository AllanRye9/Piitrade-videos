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
}

export interface AdminUser {
  id: string;
  email: string;
}

export interface AdminVideo {
  id: string;
  title: string;
  description: string;
  url: string;
  poster: string | null;
  likes: number;
  views: number;
  comments: number;
  createdAt: string;
}

export interface AdminProduct {
  id: string;
  name: string;
  price: string;
  category: string;
  image: string;
}

export interface AdminStats {
  videos: number;
  comments: number;
  products: number;
  totalViews: number;
  totalLikes: number;
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
