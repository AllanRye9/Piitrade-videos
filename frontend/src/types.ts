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
}

/** One item the viewer has added to the in-video shopping cart. */
export interface CartItem {
  productId: string;
  name: string;
  price: string;
  image: string;
  quantity: number;
}

export interface MarketplaceAccountStatus {
  linked: boolean;
}

export interface MarketplaceCheckoutResult {
  orderId: string;
  status: string;
  redirectUrl?: string;
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
