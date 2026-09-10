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
  createdAt: string;
  liked: boolean;
  favorited: boolean;
  saved: boolean;
}

export interface Comment {
  id: string;
  videoId: string;
  author: string;
  text: string;
  createdAt: string;
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

/** Response shape of POST /api/visual-search. `exists` reflects the
 *  backend's regex/chunk fuzzy-match verdict (see
 *  backend/src/lib/marketplace.ts fuzzySearchProducts): true once at
 *  least one 3-7 letter chunk of the identified text matched a
 *  marketplace listing, false if every avenue was exhausted with no
 *  match — i.e. the item genuinely isn't carried in the marketplace. */
export interface VisualSearchResponse {
  results: VisualSearchResult[];
  identification?: string;
  exists: boolean;
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
