import type { SavedItem, Video, Comment, MarketplaceSearchResponse, AccountSummary, AppNotification, TrendingHashtag, Earnings, ProductPin, ProductSuggestion, SiteInfo, SiteConfig } from './types';
import { fetchWithTimeout, isNetworkError } from './lib/net';
import { setOffline } from './state/network';
import { API_BASE } from './config';
import { getSessionId } from './lib/session';

export class ApiError extends Error {
  code?: string;
  duration?: number;
  maxSeconds?: number;
  status?: number;
  path?: string;
  constructor(message: string, extra: { code?: string; duration?: number; maxSeconds?: number; status?: number; path?: string } = {}) {
    super(message);
    this.code = extra.code;
    this.duration = extra.duration;
    this.maxSeconds = extra.maxSeconds;
    this.status = extra.status;
    this.path = extra.path;
  }
}

/** A local file picked on the device, in the shape React Native's FormData expects. */
export interface LocalFile {
  uri: string;
  name: string;
  type: string;
}

export interface AudioUpload {
  file: LocalFile;
  videoVolume: number;
  audioVolume: number;
  audioStart: number;
}

export interface TrimRange {
  start: number;
  end: number;
}

type AuthResult = { sessionId: string; email: string; handle: string | null; displayName: string | null; avatar: string | null; bio: string | null };

let onSignInRequired: (() => void) | null = null;
/** The app registers a handler that opens the sign-in popup when the server says a write needs an account. */
export function setSignInRequiredHandler(fn: (() => void) | null) {
  onSignInRequired = fn;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  let res: Response;
  try {
    res = await fetchWithTimeout(fetch, `${API_BASE}${path}`, {
      ...options,
      headers: { ...(options.headers || {}), 'X-Session-Id': getSessionId() },
    });
  } catch (err) {
    if (isNetworkError(err)) setOffline(true);
    throw err;
  }
  setOffline(false); // the server answered (even with an error status), so we're online
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => undefined);
    const fields = body && typeof body === 'object' ? body as { code?: unknown; error?: unknown } : {};
    if (res.status === 401 && fields.code === 'SIGN_IN_REQUIRED') onSignInRequired?.();
    const message = typeof fields.error === 'string' ? fields.error : `HTTP ${res.status}`;
    throw new ApiError(`${method} ${path}: ${message}`, { status: res.status, path, code: typeof fields.code === 'string' ? fields.code : undefined });
  }
  if (res.status === 204) return undefined as T;
  try {
    return await res.json();
  } catch {
    throw new ApiError(`${method} ${path} returned HTTP ${res.status} with an invalid JSON response`, { status: res.status, path });
  }
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  listVideos: (cursor?: string | null) =>
    request<{ videos: Video[]; nextCursor: string | null }>(`/api/videos${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  getTrendingVideos: () => request<{ videos: Video[] }>('/api/videos/trending'),
  searchVideos: (q: string) => request<{ videos: Video[] }>(`/api/videos/search?q=${encodeURIComponent(q)}`),
  getHashtagVideos: (tag: string, cursor?: string | null) =>
    request<{ tag: string; videos: Video[]; nextCursor: string | null }>(
      `/api/videos/hashtag/${encodeURIComponent(tag)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`
    ),
  getTrendingHashtags: () => request<{ hashtags: TrendingHashtag[] }>('/api/videos/hashtags/trending'),
  getVideo: (id: string) => request<{ video: Video }>(`/api/videos/${id}`),
  reportVideo: (id: string, reason: 'spam' | 'inappropriate' | 'copyright' | 'other') =>
    request<{ reported: boolean }>(`/api/videos/${id}/report`, json('POST', { reason })),
  /** Counts one view per session per video (server de-duplicates). Fire-and-forget. */
  recordView: (id: string) => request<{ counted: boolean }>(`/api/videos/${id}/view`, { method: 'POST' }),
  deleteVideo: (id: string) => request<void>(`/api/videos/${id}`, { method: 'DELETE' }),
  deleteComment: (videoId: string, commentId: string) => request<{ comments: number }>(`/api/videos/${videoId}/comments/${commentId}`, { method: 'DELETE' }),
  /** Logs a product tap and returns the destination with attribution params (the session id stays in a header, never a URL). */
  clickThrough: (videoId: string, target: { productId?: string; url?: string }) =>
    request<{ url: string }>('/api/attribution/click', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId, ...target }) }),
  /** Saves a pinned product to the viewer's list. Idempotent; works for guests (no sign-in prompt). */
  saveProduct: (videoId: string, productId: string) =>
    request<{ saved: boolean; id: string; count: number }>('/api/saved-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId, productId }) }),
  getSavedItems: () => request<{ items: SavedItem[] }>('/api/saved-items'),
  deleteSavedItem: (id: string) => request<void>(`/api/saved-items/${id}`, { method: 'DELETE' }),
  /** Batched viewing analytics (watch time, tag impressions). Best-effort; see lib/analytics.ts. */
  sendEvents: (events: unknown[]) =>
    request<{ accepted: number }>('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events }) }),
  getEarnings: () => request<Earnings>('/api/attribution/earnings'),
  getConfig: () => request<SiteConfig>('/api/config'),
  getSites: () => request<{ sites: SiteInfo[] }>('/api/marketplace/sites'),
  getMyProducts: (videoId: string) => request<{ products: ProductPin[] }>(`/api/videos/${videoId}/products`),
  setProducts: (videoId: string, products: ProductPin[]) => request<{ products: unknown[] }>(`/api/videos/${videoId}/products`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ products }) }),
  suggestProducts: (videoId: string) => request<{ suggestions: ProductSuggestion[] }>(`/api/videos/${videoId}/suggest-products`, { method: 'POST' }),
  shareVideo: (id: string) => request<{ shares: number }>(`/api/videos/${id}/share`, { method: 'POST' }),

  uploadVideo: (
    file: LocalFile,
    title: string,
    description: string,
    onProgress?: (pct: number) => void,
    trim?: TrimRange | null,
    audio?: AudioUpload | null,
    idempotencyKey?: string,
    products?: ProductPin[]
  ) =>
    new Promise<{ video: Video }>((resolve, reject) => {
      const form = new FormData();
      // React Native's FormData accepts { uri, name, type } and streams the file from disk.
      form.append('video', file as unknown as Blob);
      form.append('title', title);
      form.append('description', description);
      if (products && products.length) form.append('products', JSON.stringify(products));
      if (trim) {
        form.append('trimStart', trim.start.toFixed(3));
        form.append('trimEnd', trim.end.toFixed(3));
      }
      if (audio) {
        form.append('videoVolume', String(audio.videoVolume));
        form.append('audioVolume', String(audio.audioVolume));
        form.append('audioStart', audio.audioStart.toFixed(3));
        form.append('audio', audio.file as unknown as Blob);
      }
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/api/videos`);
      xhr.setRequestHeader('X-Session-Id', getSessionId());
      // Same key on every retry of this upload, so a retry after a dropped connection returns the
      // video the server already created instead of posting a duplicate.
      if (idempotencyKey) xhr.setRequestHeader('X-Idempotency-Key', idempotencyKey);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        setOffline(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new ApiError(`POST /api/videos returned HTTP ${xhr.status} with an invalid JSON response`, { status: xhr.status, path: '/api/videos' }));
          }
          return;
        }
        try {
          const body = JSON.parse(xhr.responseText);
          if (xhr.status === 401 && body.code === 'SIGN_IN_REQUIRED') onSignInRequired?.();
          reject(new ApiError(`POST /api/videos: ${body.error || `HTTP ${xhr.status}`}`, { code: body.code, duration: body.duration, maxSeconds: body.maxSeconds, status: xhr.status, path: '/api/videos' }));
        } catch {
          reject(new ApiError(`POST /api/videos failed with HTTP ${xhr.status}`, { status: xhr.status, path: '/api/videos' }));
        }
      };
      xhr.onerror = () => {
        setOffline(true);
        reject(new Error('POST /api/videos failed — network error'));
      };
      xhr.send(form);
    }),

  like: (id: string) => request<{ liked: boolean; likes: number }>(`/api/videos/${id}/like`, { method: 'POST' }),
  favorite: (id: string) => request<{ favorited: boolean }>(`/api/videos/${id}/favorite`, { method: 'POST' }),
  save: (id: string) => request<{ saved: boolean }>(`/api/videos/${id}/save`, { method: 'POST' }),

  getComments: (id: string) => request<{ comments: Comment[] }>(`/api/videos/${id}/comments`),
  getReplies: (id: string, commentId: string) => request<{ replies: Comment[] }>(`/api/videos/${id}/comments/${commentId}/replies`),
  likeComment: (id: string, commentId: string) =>
    request<{ liked: boolean; likes: number }>(`/api/videos/${id}/comments/${commentId}/like`, { method: 'POST' }),
  postComment: (id: string, text: string, author?: string, parentId?: string) =>
    request<{ comment: Comment; comments: number }>(`/api/videos/${id}/comments`, json('POST', { text, author, parentId })),

  marketplaceSearch: (query: string) => request<MarketplaceSearchResponse>(`/api/marketplace/search?q=${encodeURIComponent(query)}`),

  getProfile: () => request<{ avatar: string | null; displayName: string | null; handle: string | null; bio: string | null }>('/api/profile'),
  updateProfile: (fields: { displayName?: string | null; bio?: string | null }) =>
    request<{ displayName: string | null; bio: string | null }>('/api/profile', json('PUT', fields)),
  updateHandle: (handle: string) => request<{ handle: string }>('/api/profile/handle', json('PUT', { handle })),
  uploadAvatar: (file: LocalFile) => {
    const form = new FormData();
    form.append('avatar', file as unknown as Blob);
    return request<{ avatar: string }>('/api/profile/avatar', { method: 'POST', body: form });
  },
  deleteAvatar: () => request<void>('/api/profile/avatar', { method: 'DELETE' }),

  discoverAccounts: (q?: string) => request<{ accounts: AccountSummary[] }>(`/api/accounts${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getAccount: (handle: string) => request<{ account: AccountSummary; videos: Video[] }>(`/api/accounts/${encodeURIComponent(handle)}`),
  followAccount: (handle: string) =>
    request<{ following: boolean; followersCount: number }>(`/api/accounts/${encodeURIComponent(handle)}/follow`, { method: 'POST' }),

  getNotifications: (cursor?: string | null) =>
    request<{ notifications: AppNotification[]; nextCursor: string | null; unreadCount: number }>(
      `/api/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`
    ),
  markNotificationsRead: () => request<{ ok: boolean }>('/api/notifications/read-all', { method: 'POST' }),

  signup: (email: string, password: string) => request<AuthResult>('/api/account/signup', json('POST', { email, password })),
  login: (emailOrHandle: string, password: string) => request<AuthResult>('/api/account/login', json('POST', { emailOrHandle, password })),
  forgotPassword: (emailOrHandle: string) => request<{ message: string }>('/api/account/forgot-password', json('POST', { emailOrHandle })),
};
