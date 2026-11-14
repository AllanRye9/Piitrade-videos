import type { Video, Comment, MarketplaceSearchResponse, AccountSummary, AppNotification, TrendingHashtag } from './types';
import { API_BASE } from './config';
import { getSessionId } from './lib/session';

export class ApiError extends Error {
  code?: string;
  duration?: number;
  maxSeconds?: number;
  constructor(message: string, extra: { code?: string; duration?: number; maxSeconds?: number } = {}) {
    super(message);
    this.code = extra.code;
    this.duration = extra.duration;
    this.maxSeconds = extra.maxSeconds;
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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), 'X-Session-Id': getSessionId() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
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
  shareVideo: (id: string) => request<{ shares: number }>(`/api/videos/${id}/share`, { method: 'POST' }),

  uploadVideo: (
    file: LocalFile,
    title: string,
    description: string,
    onProgress?: (pct: number) => void,
    trim?: TrimRange | null,
    audio?: AudioUpload | null
  ) =>
    new Promise<{ video: Video }>((resolve, reject) => {
      const form = new FormData();
      // React Native's FormData accepts { uri, name, type } and streams the file from disk.
      form.append('video', file as unknown as Blob);
      form.append('title', title);
      form.append('description', description);
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
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
          return;
        }
        try {
          const body = JSON.parse(xhr.responseText);
          reject(new ApiError(body.error || 'Upload failed', { code: body.code, duration: body.duration, maxSeconds: body.maxSeconds }));
        } catch {
          reject(new ApiError('Upload failed'));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed — network error'));
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
