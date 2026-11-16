import { API_BASE } from '../config';
import { getAdminToken, setAdminToken } from '../api';

// ---------- types ----------
export type Role = 'PRIMARY' | 'SECONDARY';

export interface Admin {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Effective permissions ("videos.delete"); the primary admin has all of them. */
  permissions: string[];
}

export interface AdminRecord extends Admin {
  disabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface LocationOption {
  id: string;
  name: string;
}

export interface LocationRecord extends LocationOption {
  country: string;
  city: string;
  videoCount: number;
  userCount: number;
  createdAt: string;
}

export interface UserRecord {
  id: string;
  email: string;
  createdAt: string;
  suspendedAt: string | null;
  status: 'active' | 'suspended';
  handle: string | null;
  displayName: string | null;
  bio: string | null;
  avatar: string | null;
  locationId: string | null;
  location: LocationOption | null;
  videoCount?: number;
}

export interface UserDetail extends UserRecord {
  commentCount: number;
  followers: number;
  following: number;
  recentVideos: Array<{ id: string; title: string; poster: string | null; views: number; likes: number; createdAt: string }>;
}

export interface VideoRecord {
  id: string;
  title: string;
  description: string;
  url: string;
  poster: string | null;
  duration: number | null;
  size: number;
  likes: number;
  views: number;
  comments: number;
  shares: number;
  hashtags: string[];
  createdAt: string;
  locationId: string | null;
  location: LocationOption | null;
  uploader: { handle: string | null; displayName: string | null; userId: string | null } | null;
  reportCount: number;
}

export interface CommentRecord {
  id: string;
  text: string;
  author: string;
  likes: number;
  isReply: boolean;
  createdAt: string;
  video: { id: string; title: string } | null;
}

export interface ReportGroup {
  videoId: string;
  title: string;
  url: string;
  poster: string | null;
  reportCount: number;
  reasons: string[];
  lastReportedAt: string | null;
}

export interface ProductRecord {
  id: string;
  name: string;
  price: string;
  category: string;
  image: string;
}

export interface AuditEntry {
  id: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  detail: string | null;
  createdAt: string;
}

export interface ResourceDef {
  key: string;
  label: string;
  actions: Array<'view' | 'create' | 'edit' | 'delete'>;
}

export interface DashboardStats {
  users?: { total: number; suspended: number; newThisWeek: number };
  videos?: {
    total: number;
    newThisWeek: number;
    totalViews: number;
    totalLikes: number;
    totalShares: number;
    recent: Array<{ id: string; title: string; views: number; likes: number; createdAt: string }>;
  };
  comments?: { total: number };
  reports?: { openVideos: number };
  products?: { total: number };
  locations?: { total: number };
  admins?: { total: number };
}

// ---------- transport ----------
export const UNAUTHORIZED_EVENT = 'piitrade-admin-unauthorized';

type Query = Record<string, string | number | boolean | null | undefined>;

function qs(query?: Query): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function req<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const token = getAdminToken();
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(`${API_BASE}${path}${qs(query)}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    // Only treat 401 as "signed out" when we actually sent a token — a wrong
    // password on the login form is also a 401 and must not look like expiry.
    if (res.status === 401 && token) {
      setAdminToken(null);
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

const get = <T,>(path: string, query?: Query) => req<T>('GET', path, undefined, query);
const post = <T,>(path: string, body?: unknown) => req<T>('POST', path, body ?? {});
const patch = <T,>(path: string, body: unknown) => req<T>('PATCH', path, body);
const del = <T = void,>(path: string, query?: Query) => req<T>('DELETE', path, undefined, query);

type List = { q?: string; page?: number; limit?: number };

// ---------- API ----------
export const adminApi = {
  // auth
  setupStatus: () => get<{ needsSetup: boolean; requiresSetupCode: boolean }>('/api/auth/setup-status'),
  register: (data: { email: string; password: string; name?: string; setupCode?: string }) =>
    post<{ token: string; admin: Admin }>('/api/auth/register', data),
  login: (email: string, password: string) => post<{ token: string; admin: Admin }>('/api/auth/login', { email, password }),
  me: () => get<{ admin: Admin }>('/api/auth/me'),
  updateMe: (name: string) => patch<{ admin: Admin }>('/api/auth/me', { name }),
  changePassword: (currentPassword: string, newPassword: string) => post<void>('/api/auth/password', { currentPassword, newPassword }),

  // dashboard
  stats: () => get<DashboardStats>('/api/admin/stats'),
  permissionCatalog: () => get<{ resources: ResourceDef[] }>('/api/admin/permissions'),

  // users
  listUsers: (q: List & { status?: string; locationId?: string }) => get<{ users: UserRecord[] } & PageMeta>('/api/admin/users', q),
  getUser: (id: string) => get<{ user: UserDetail }>(`/api/admin/users/${id}`),
  createUser: (data: Record<string, unknown>) => post<{ user: UserRecord }>('/api/admin/users', data),
  updateUser: (id: string, data: Record<string, unknown>) => patch<{ user: UserRecord }>(`/api/admin/users/${id}`, data),
  suspendUser: (id: string, reason?: string) => post<void>(`/api/admin/users/${id}/suspend`, { reason }),
  unsuspendUser: (id: string) => post<void>(`/api/admin/users/${id}/unsuspend`),
  deleteUser: (id: string, deleteContent: boolean) => del(`/api/admin/users/${id}`, { deleteContent }),

  // videos
  listVideos: (q: List & { sort?: string; locationId?: string; reported?: boolean; uploader?: string }) =>
    get<{ videos: VideoRecord[] } & PageMeta>('/api/admin/videos', q),
  getVideo: (id: string) => get<{ video: VideoRecord; reports: Array<{ reason: string; createdAt: string }> }>(`/api/admin/videos/${id}`),
  updateVideo: (id: string, data: { title?: string; description?: string; locationId?: string | null }) =>
    patch<{ video: VideoRecord }>(`/api/admin/videos/${id}`, data),
  deleteVideo: (id: string) => del(`/api/admin/videos/${id}`),
  videoComments: (id: string) => get<{ comments: Array<{ id: string; author: string; text: string; createdAt: string }> }>(`/api/admin/videos/${id}/comments`),

  // comments
  listComments: (q: List & { videoId?: string }) => get<{ comments: CommentRecord[] } & PageMeta>('/api/admin/comments', q),
  updateComment: (id: string, text: string) => patch<void>(`/api/admin/comments/${id}`, { text }),
  deleteComment: (id: string) => del(`/api/admin/comments/${id}`),

  // reports
  listReports: () => get<{ reports: ReportGroup[] }>('/api/admin/reports'),
  dismissReports: (videoId: string) => del(`/api/admin/reports/${videoId}`),

  // products
  listProducts: (q?: string) => get<{ products: ProductRecord[] }>('/api/admin/products', { q }),
  createProduct: (d: { name: string; price: string; category: string; image: File }) => {
    const f = new FormData();
    f.append('name', d.name);
    f.append('price', d.price);
    f.append('category', d.category);
    f.append('image', d.image);
    return req<{ product: ProductRecord }>('POST', '/api/admin/products', f);
  },
  updateProduct: (id: string, d: { name?: string; price?: string; category?: string; image?: File | null }) => {
    const f = new FormData();
    if (d.name !== undefined) f.append('name', d.name);
    if (d.price !== undefined) f.append('price', d.price);
    if (d.category !== undefined) f.append('category', d.category);
    if (d.image) f.append('image', d.image);
    return req<{ product: ProductRecord }>('PATCH', `/api/admin/products/${id}`, f);
  },
  deleteProduct: (id: string) => del(`/api/admin/products/${id}`),

  // locations
  locationOptions: () => get<{ locations: LocationOption[] }>('/api/admin/locations/options'),
  listLocations: (q?: string) => get<{ locations: LocationRecord[] }>('/api/admin/locations', { q }),
  createLocation: (d: { name: string; country?: string; city?: string }) => post<{ location: LocationRecord }>('/api/admin/locations', d),
  updateLocation: (id: string, d: { name?: string; country?: string; city?: string }) => patch<{ location: LocationRecord }>(`/api/admin/locations/${id}`, d),
  deleteLocation: (id: string) => del(`/api/admin/locations/${id}`),

  // admins (primary only)
  listAdmins: () => get<{ admins: AdminRecord[] }>('/api/admin/admins'),
  createAdmin: (d: { email: string; name?: string; password: string; permissions: string[] }) => post<{ admin: AdminRecord }>('/api/admin/admins', d),
  updateAdmin: (id: string, d: { email?: string; name?: string; password?: string; permissions?: string[]; disabled?: boolean }) =>
    patch<{ admin: AdminRecord }>(`/api/admin/admins/${id}`, d),
  deleteAdmin: (id: string) => del(`/api/admin/admins/${id}`),

  // audit (primary only)
  listAudit: (q: List) => get<{ entries: AuditEntry[] } & PageMeta>('/api/admin/audit', q),
};
