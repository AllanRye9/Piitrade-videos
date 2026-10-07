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

export interface VisualSearchResult {
  id: string;
  name: string;
  price: string;
  category: string;
  image: string;
  match: number;
  // Present when the result came from the AI-identify + marketplace
  // pipeline (see backend AI_SEARCH/MARKETPLACE_API); absent for the
  // local phash-catalog fallback.
  description?: string;
  productUrl?: string;
  inStock?: boolean;
  /** The marketplace seller this listing belongs to — carried through
   *  to checkout so items can be grouped into same-seller orders
   *  (the marketplace requires every item in one order to share a
   *  seller). Absent for local phash-catalog results. */
  sellerId?: string;
}

/** One item the viewer has added to the in-video shopping cart. */
export interface CartItem {
  productId: string;
  name: string;
  price: string;
  image: string;
  quantity: number;
  sellerId?: string;
}

export interface MarketplaceAccountStatus {
  linked: boolean;
}

/** Countries the marketplace accepts at registration. */
export type MarketplaceCountry = 'UAE' | 'UGANDA' | 'KENYA' | 'CHINA';

/** Registering never returns a usable session — the marketplace
 *  requires email verification before login. */
export interface MarketplaceRegistrationResult {
  linked: false;
  verificationRequired: true;
  message: string;
}

export interface MarketplaceCheckoutResult {
  orderId: string;
  orderNumber?: string;
  status: string;
  redirectUrl?: string;
}

/** One order per seller group — checkout can produce more than one
 *  order when the cart contains items from different sellers. */
export interface MarketplaceCheckoutResponse {
  orders: MarketplaceCheckoutResult[];
  failed?: Array<{ items: Array<{ productId: string; quantity: number }>; error: string }>;
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
