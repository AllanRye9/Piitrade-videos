import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAdminAuth } from './AdminAuthContext';
import { ADMIN_BASE } from './paths';

/** Redirects to the admin sign-in page unless an admin is signed in. */
export default function RequireAdmin({ children }: { children: React.ReactElement }) {
  const { admin, loading } = useAdminAuth();
  const location = useLocation();

  if (loading) {
    return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-white/50 text-sm">Loading…</div>;
  }
  if (!admin) {
    return <Navigate to={`${ADMIN_BASE}/login`} replace state={{ from: location.pathname }} />;
  }
  return children;
}

/** Page-level guard: shows an "access denied" panel when the admin lacks the permission. */
export function RequirePermission({ permission, primaryOnly, children }: { permission?: string; primaryOnly?: boolean; children: React.ReactElement }) {
  const { can, isPrimary } = useAdminAuth();
  const allowed = primaryOnly ? isPrimary : permission ? can(permission) : true;
  if (allowed) return children;
  return (
    <div className="max-w-md mx-auto text-center py-20">
      <ShieldAlert className="mx-auto text-brand-amber mb-3" size={32} />
      <h1 className="text-white font-semibold text-lg">You don’t have access to this section</h1>
      <p className="text-white/50 text-sm mt-1">Ask the primary admin to grant you the permission if you need it.</p>
    </div>
  );
}
