import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { adminApi, getAdminToken, setAdminToken } from '../api';
import type { AdminUser } from '../types';

interface AdminAuthContextValue {
  admin: AdminUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, setupCode?: string) => Promise<void>;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
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

  async function login(email: string, password: string) {
    const res = await adminApi.login(email, password);
    setAdminToken(res.token);
    setAdmin(res.admin);
  }

  async function register(email: string, password: string, setupCode?: string) {
    const res = await adminApi.register(email, password, setupCode);
    setAdminToken(res.token);
    setAdmin(res.admin);
  }

  function logout() {
    setAdminToken(null);
    setAdmin(null);
  }

  return (
    <AdminAuthContext.Provider value={{ admin, loading, login, register, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}
