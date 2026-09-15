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
  /** The uploader's anonymous session id — links to their public creator page. Null for videos with no known uploader. */
  uploaderSessionId: string | null;
  uploaderDisplayName: string | null;
  uploaderAvatar: string | null;
}

export interface Creator {
  sessionId: string;
  displayName: string | null;
  avatar: string | null;
  videoCount: number;
  totalLikes: number;
  totalViews: number;
}

export interface CreatorVideoSummary {
  id: string;
  title: string;
  poster: string;
  likes: number;
  views: number;
  comments: number;
  createdAt: string;
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
  /** Every image the listing has (for the zoom/gallery viewer) — at
   *  minimum contains `image` itself when any image exists. */
  images?: string[];
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
   *  seller). Absent for local phash-catalog results — those are sold
   *  directly by Piitrade itself, not a third-party seller. */
  sellerId?: string;
  sellerName?: string;
  /** Best-effort seller contact (phone or email), shown at checkout so a
   *  buyer knows who to arrange payment/pickup with. May be absent even
   *  for a marketplace result if the listing doesn't expose one. */
  sellerContact?: string;
}

/** One item the viewer has added to the in-video shopping cart. */
export interface CartItem {
  productId: string;
  name: string;
  price: string;
  image: string;
  quantity: number;
  sellerId?: string;
  sellerName?: string;
  sellerContact?: string;
}

/** Delivery details confirmed at checkout — stored on every resulting
 *  local Order so purchase history shows exactly what was confirmed. */
export interface DeliveryAddress {
  name: string;
  phone: string;
  address: string;
}

/** Mock payment details collected only for admin-catalog (Piitrade's own)
 *  items — there's no real payment gateway wired up, so only the last 4
 *  digits of the card are ever sent back from the server/stored. */
export interface PaymentDetails {
  cardName: string;
  cardNumber: string;
  expiry: string;
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
  /** 'admin' — fulfilled directly by Piitrade, paid via the card details
   *  collected at checkout. 'marketplace' — placed on the real external
   *  marketplace under a third-party seller; see sellerName/sellerContact
   *  to arrange payment/pickup (no online payment gateway there). */
  source: 'admin' | 'marketplace';
  orderId: string;
  orderNumber?: string;
  status: string;
  sellerId?: string;
  sellerName?: string;
  sellerContact?: string;
}

/** One order per seller group (plus at most one combined admin order) —
 *  checkout can produce more than one order when the cart contains items
 *  from different sellers, or a mix of Piitrade's own goods and
 *  marketplace listings. */
export interface MarketplaceCheckoutResponse {
  orders: MarketplaceCheckoutResult[];
  failed?: Array<{ items: Array<{ productId: string; quantity: number }>; error: string }>;
  /** Where to send the buyer to actually complete a marketplace-sourced
   *  transaction (it has no online payment gateway, so this is its cart
   *  page, not a payment page — see backend for why). Absent when every
   *  order placed was admin-fulfilled (already fully paid). */
  redirectUrl?: string;
}

/** One item as recorded on a past order — a snapshot taken at checkout
 *  time, so it still shows the right name/image/price even if the
 *  source listing later changes or disappears. */
export interface OrderItemRecord {
  id: string;
  productId: string;
  name: string;
  image: string | null;
  price: string;
  quantity: number;
}

/** A past order, as shown in the profile page's purchase history. */
export interface OrderRecord {
  id: string;
  source: 'admin' | 'marketplace';
  status: string;
  sellerId: string | null;
  sellerName: string | null;
  sellerContact: string | null;
  marketplaceOrderId: string | null;
  marketplaceOrderNumber: string | null;
  deliveryName: string;
  deliveryPhone: string;
  deliveryAddress: string;
  paymentMethod: string | null;
  paymentLast4: string | null;
  createdAt: string;
  items: OrderItemRecord[];
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
