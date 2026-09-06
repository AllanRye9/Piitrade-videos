import type { Video, Comment, VisualSearchResult } from './types';

const SESSION_KEY = 'piitrade_session_id';

function getSessionId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
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
      xhr.open('POST', '/api/videos');
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
    return request<{ results: VisualSearchResult[] }>('/api/visual-search', {
      method: 'POST',
      body: form,
    });
  },
};
