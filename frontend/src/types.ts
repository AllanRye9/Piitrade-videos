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
