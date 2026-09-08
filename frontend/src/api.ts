import type {
  Video,
  Comment,
  VisualSearchResult,
  AdminUser,
  AdminVideo,
  AdminProduct,
  AdminStats,
  MarketplaceAccountStatus,
  MarketplaceCheckoutResult,
} from './types';
import { API_BASE } from './config';

const SESSION_KEY = 'piitrade_session_id';
const ADMIN_TOKEN_KEY = 'piitrade_admin_token';

/**
 * `crypto.randomUUID()` is only available in secure contexts (HTTPS)
 * on fairly recent browsers (Safari 15.4+, Chrome/Edge 92+, Firefox
 * 95+) — older engines, and plain-HTTP local/LAN testing, don't have
 * it. This falls back to `crypto.getRandomValues` (near-universal),
 * and finally to `Math.random` so the app still works end-to-end
 * everywhere rather than throwing on session creation.
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getSessionId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = generateUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function getAdminToken(): string | null {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token: string | null) {
  if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
  else localStorage.removeItem(ADMIN_TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-Session-Id': getSessionId(),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401) setAdminToken(null);
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  listVideos: () => request<{ videos: Video[] }>('/api/videos'),

  searchVideos: (q: string) => request<{ videos: Video[] }>(`/api/videos/search?q=${encodeURIComponent(q)}`),

  getVideo: (id: string) => request<{ video: Video }>(`/api/videos/${id}`),

  uploadVideo: (file: File, title: string, description: string, onProgress?: (pct: number) => void) => {
    return new Promise<{ video: Video }>((resolve, reject) => {
      const form = new FormData();
      form.append('video', file);
      form.append('title', title);
      form.append('description', description);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/api/videos`);
      xhr.setRequestHeader('X-Session-Id', getSessionId());
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          try {
            reject(new Error(JSON.parse(xhr.responseText).error || 'Upload failed'));
          } catch {
            reject(new Error('Upload failed'));
          }
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed — network error'));
      xhr.send(form);
    });
  },

  like: (id: string) => request<{ liked: boolean; likes: number }>(`/api/videos/${id}/like`, { method: 'POST' }),
  favorite: (id: string) => request<{ favorited: boolean }>(`/api/videos/${id}/favorite`, { method: 'POST' }),
  save: (id: string) => request<{ saved: boolean }>(`/api/videos/${id}/save`, { method: 'POST' }),

  getComments: (id: string) => request<{ comments: Comment[] }>(`/api/videos/${id}/comments`),
  postComment: (id: string, text: string, author?: string) =>
    request<{ comment: Comment; comments: number }>(`/api/videos/${id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, author }),
    }),

  visualSearch: (imageBlob: Blob) => {
    const form = new FormData();
    form.append('image', imageBlob, 'crop.jpg');
    return request<{ results: VisualSearchResult[]; identification?: string }>('/api/visual-search', {
      method: 'POST',
      body: form,
    });
  },

  marketplaceAccount: () => request<MarketplaceAccountStatus>('/api/marketplace/account'),

  marketplaceLogin: (email: string, password: string) =>
    request<MarketplaceAccountStatus>('/api/marketplace/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),

  marketplaceRegister: (email: string, password: string, name?: string) =>
    request<MarketplaceAccountStatus>('/api/marketplace/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    }),

  marketplaceCheckout: (items: Array<{ productId: string; quantity: number }>) =>
    request<MarketplaceCheckoutResult>('/api/marketplace/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    }),
};

export const adminApi = {
  register: (email: string, password: string, setupCode?: string) =>
    request<{ token: string; admin: AdminUser }>('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, setupCode }),
    }),

  login: (email: string, password: string) =>
    request<{ token: string; admin: AdminUser }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),

  me: () => adminRequest<{ admin: AdminUser }>('/api/auth/me'),

  stats: () => adminRequest<AdminStats>('/api/admin/stats'),

  listVideos: () => adminRequest<{ videos: AdminVideo[] }>('/api/admin/videos'),
  updateVideo: (id: string, data: { title?: string; description?: string }) =>
    adminRequest<{ video: AdminVideo }>(`/api/admin/videos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  deleteVideo: (id: string) => adminRequest<void>(`/api/admin/videos/${id}`, { method: 'DELETE' }),

  getVideoComments: (id: string) => adminRequest<{ comments: Comment[] }>(`/api/admin/videos/${id}/comments`),
  deleteComment: (id: string) => adminRequest<void>(`/api/admin/comments/${id}`, { method: 'DELETE' }),

  listProducts: () => adminRequest<{ products: AdminProduct[] }>('/api/admin/products'),
  createProduct: (name: string, price: string, category: string, image: File) => {
    const form = new FormData();
    form.append('name', name);
    form.append('price', price);
    form.append('category', category);
    form.append('image', image);
    return adminRequest<{ product: AdminProduct }>('/api/admin/products', { method: 'POST', body: form });
  },
  updateProduct: (id: string, data: { name?: string; price?: string; category?: string; image?: File }) => {
    const form = new FormData();
    if (data.name !== undefined) form.append('name', data.name);
    if (data.price !== undefined) form.append('price', data.price);
    if (data.category !== undefined) form.append('category', data.category);
    if (data.image) form.append('image', data.image);
    return adminRequest<{ product: AdminProduct }>(`/api/admin/products/${id}`, { method: 'PATCH', body: form });
  },
  deleteProduct: (id: string) => adminRequest<void>(`/api/admin/products/${id}`, { method: 'DELETE' }),
};
