import { API_BASE } from '../lib/config';
import { getAdminToken, setAdminToken } from '../lib/api';

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
  hidden: boolean;
  hiddenAt: string | null;
  /** 0-based position in the pinned list (top of the feed); null = not pinned. */
  pinRank: number | null;
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
  actions: Array<'view' | 'create' | 'edit' | 'delete' | 'manage'>;
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

export interface SiteRecord {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
  apiBase: string;
  apiType: string;
  country: string;
  currency: string;
  commissionPct: number;
  active: boolean;
  /** Sites allowed to embed videos carrying this shop's products, one origin per line; empty = anywhere. */
  embedOrigins: string;
  createdAt: string;
  secretHint: string;
  clicks?: number;
  conversions?: number;
}

export interface SpecIssue {
  level: 'error' | 'warning';
  message: string;
}
export interface SiteTestResult {
  ok: boolean;
  status?: number;
  ms: number;
  issues: SpecIssue[];
  sampleCount?: number;
}

export interface PartnerApplicationRecord {
  id: string;
  name: string;
  baseUrl: string;
  apiBase: string;
  country: string;
  currency: string;
  contactName: string;
  contactEmail: string;
  notes: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewNote: string;
  siteId: string | null;
  /** The listing-API check made when the shop applied. */
  verification: { ok: boolean; ms: number; sampleCount: number; issues: SpecIssue[] } | null;
  createdAt: string;
  reviewedAt: string | null;
}

/** Mirrors backend/src/lib/core/settings.ts. */
export interface SiteSettings {
  guestPrompt: { enabled: boolean; firstAfterSeconds: number; baseGapSeconds: number; backoff: number; maxPerSession: number; autoHideSeconds: number };
  maintenance: { enabled: boolean; message: string };
  announcement: { enabled: boolean; text: string; link: string; level: 'info' | 'success' | 'warning'; version: string };
  features: { signups: boolean; uploads: boolean; comments: boolean; partnerApplications: boolean };
  app: { minVersion: string; latestVersion: string; updateUrl: string; updateMessage: string };
}
export interface SettingsRecord {
  settings: SiteSettings;
  updatedAt: string | null;
  updatedBy: string;
}

export interface SeriesBlock {
  series: Array<{ day: string; value: number }>;
  total: number;
  /** The same count over the equally long period before this one. */
  previous: number;
}
export interface AnalyticsData {
  days: number;
  signups?: SeriesBlock;
  uploads?: SeriesBlock;
  comments?: SeriesBlock;
  clicks?: SeriesBlock;
  conversions?: SeriesBlock;
  topVideos?: Array<{ id: string; title: string; views: number; likes: number; shares: number }>;
  topShops?: Array<{ siteId: string; name: string; clicks: number }>;
  funnel?: { impressions: number; saves: number; clicks: number; conversions: number };
  partners?: { pendingApplications: number; activeShops: number; totalShops: number };
}

export interface SystemInfo {
  db: { ok: boolean; ms: number; error?: string };
  migrations: { applied: number; failed: number; latest: string | null; expected: number } | null;
  runtime: { node: string; uptimeSeconds: number; rssMb: number; env: string; version: string };
  config: Record<string, boolean>;
}

export interface AttributionOverview {
  days: number;
  totals: { saves: number; clicks: number; conversions: number; revenue: Record<string, number>; credited: Record<string, number> };
  sites: Array<{ site: string; saves: number; clicks: number; conversions: number; revenue: Record<string, number> }>;
  topVideos: Array<{ videoId: string; title: string; clicks: number; conversions: number }>;
  topCreators: Array<{ handle: string; clicks: number; conversions: number; earned: Record<string, number> }>;
}

export interface CohortSummary {
  sessions: number;
  watchThrough: number;
  sd: number;
  completionRate: number;
  avgWatchSec: number;
}
export type GuardrailVerdict = 'insufficient_data' | 'no_harm' | 'harm' | 'benefit';
export interface GuardrailReport {
  days: number;
  holdoutPct: number;
  cohorts: { exposed: CohortSummary; holdout: CohortSummary; untagged: CohortSummary };
  comparison: { verdict: GuardrailVerdict; deltaWatchThrough: number; ci95: [number | null, number | null]; deltaCompletion: number; pValue: number | null; minSessions: number };
  funnel: Array<{ site: string; impressions: number; saves: number; clicks: number; sales: number; saveRate: number | null; clickRate: number | null; saleRate: number | null }>;
}

export type PayoutStatus = 'pending' | 'approved' | 'paid' | 'reversed';
export interface PayoutRecord {
  id: string;
  creator: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  createdAt: string;
  site: string;
  orderId: string;
  orderAmount: number;
  videoTitle: string | null;
}

export interface ProductPin {
  id?: string;
  url: string;
  title: string;
  startMs: number;
  endMs: number | null;
  x?: number | null;
  y?: number | null;
  site?: string;
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
const put = <T,>(path: string, body: unknown) => req<T>('PUT', path, body);
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
  analytics: (days: number) => get<AnalyticsData>('/api/admin/analytics', { days }),
  getSettings: () => get<SettingsRecord>('/api/admin/settings'),
  saveSettings: (patch: Partial<{ [K in keyof SiteSettings]: Partial<SiteSettings[K]> }>) => put<SettingsRecord & { changed: string[] }>('/api/admin/settings', patch),
  systemInfo: () => get<SystemInfo>('/api/admin/system'),
  clearCaches: () => post<{ ok: boolean }>('/api/admin/system/clear-caches'),
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
  listVideos: (q: List & { sort?: string; locationId?: string; reported?: boolean; uploader?: string; status?: string }) =>
    get<{ videos: VideoRecord[] } & PageMeta>('/api/admin/videos', q),
  getVideo: (id: string) => get<{ video: VideoRecord; reports: Array<{ reason: string; createdAt: string }> }>(`/api/admin/videos/${id}`),
  updateVideo: (id: string, data: { title?: string; description?: string; locationId?: string | null }) =>
    patch<{ video: VideoRecord }>(`/api/admin/videos/${id}`, data),
  deleteVideo: (id: string) => del(`/api/admin/videos/${id}`),
  hideVideo: (id: string) => post<{ video: VideoRecord }>(`/api/admin/videos/${id}/hide`, {}),
  unhideVideo: (id: string) => post<{ video: VideoRecord }>(`/api/admin/videos/${id}/unhide`, {}),
  pinVideo: (id: string, pinned: boolean, position?: number) => put<{ pinned: boolean; ids: string[] }>(`/api/admin/videos/${id}/pin`, { pinned, position }),
  reorderPins: (ids: string[]) => put<{ ids: string[] }>('/api/admin/videos/pins/order', { ids }),
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

  // shops, attribution, payouts
  listSites: () => get<{ sites: SiteRecord[] }>('/api/admin/sites'),
  createSite: (d: Record<string, unknown>) => post<{ site: SiteRecord; postbackSecret: string }>('/api/admin/sites', d),
  updateSite: (id: string, d: Record<string, unknown>) => patch<{ site: SiteRecord }>(`/api/admin/sites/${id}`, d),
  revealSiteSecret: (id: string) => get<{ postbackSecret: string }>(`/api/admin/sites/${id}/secret`),
  rotateSiteSecret: (id: string) => post<{ postbackSecret: string }>(`/api/admin/sites/${id}/rotate-secret`),
  testSite: (id: string) => post<SiteTestResult>(`/api/admin/sites/${id}/test`),
  deleteSite: (id: string) => del(`/api/admin/sites/${id}`),
  listPartnerApplications: (status?: string) => get<{ applications: PartnerApplicationRecord[] }>('/api/admin/partner-applications', { status }),
  recheckPartnerApplication: (id: string) => post<SiteTestResult>(`/api/admin/partner-applications/${id}/recheck`),
  approvePartnerApplication: (id: string, commissionPct: number, reviewNote?: string) =>
    post<{ siteId: string }>(`/api/admin/partner-applications/${id}/approve`, { commissionPct, reviewNote }),
  rejectPartnerApplication: (id: string, reviewNote?: string) => post<{ ok: boolean }>(`/api/admin/partner-applications/${id}/reject`, { reviewNote }),
  attributionOverview: (q: { days?: number; siteId?: string }) => get<AttributionOverview>('/api/admin/attribution/overview', q),
  guardrail: (days: number) => get<GuardrailReport>('/api/admin/attribution/guardrail', { days }),
  listPayouts: (q: { status?: string; page?: number; limit?: number }) => get<{ entries: PayoutRecord[] } & PageMeta>('/api/admin/attribution/payouts', q),
  setPayoutStatus: (id: string, status: PayoutStatus) => patch<{ ok: boolean }>(`/api/admin/attribution/payouts/${id}`, { status }),
  getVideoProducts: (id: string) => get<{ products: ProductPin[] }>(`/api/admin/videos/${id}/products`),
  setVideoProducts: (id: string, products: ProductPin[]) => req<{ count: number }>('PUT', `/api/admin/videos/${id}/products`, { products }),

  // audit (primary only)
  listAudit: (q: List) => get<{ entries: AuditEntry[] } & PageMeta>('/api/admin/audit', q),
};
