import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { getAdminToken, setAdminToken } from '../api';
import { adminApi, Admin, UNAUTHORIZED_EVENT } from './adminApi';

interface AdminAuthContextValue {
  admin: Admin | null;
  loading: boolean;
  isPrimary: boolean;
  /** True if the signed-in admin holds the permission (the primary holds all). */
  can: (permission: string) => boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; name?: string; setupCode?: string }) => Promise<void>;
  setAdmin: (admin: Admin) => void;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getAdminToken()) {
      setLoading(false);
      return;
    }
    adminApi
      .me()
      .then((res) => setAdmin(res.admin))
      .catch(() => setAdminToken(null))
      .finally(() => setLoading(false));
  }, []);

  // Any API call that comes back 401 (expired token, admin deleted) signs us out.
  useEffect(() => {
    const onUnauthorized = () => setAdmin(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await adminApi.login(email, password);
    setAdminToken(res.token);
    setAdmin(res.admin);
  }, []);

  const register = useCallback(async (data: { email: string; password: string; name?: string; setupCode?: string }) => {
    const res = await adminApi.register(data);
    setAdminToken(res.token);
    setAdmin(res.admin);
  }, []);

  const logout = useCallback(() => {
    setAdminToken(null);
    setAdmin(null);
  }, []);

  const value = useMemo<AdminAuthContextValue>(
    () => ({
      admin,
      loading,
      isPrimary: admin?.role === 'PRIMARY',
      can: (p: string) => !!admin && (admin.role === 'PRIMARY' || admin.permissions.includes(p)),
      login,
      register,
      setAdmin,
      logout,
    }),
    [admin, loading, login, register, logout]
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}
