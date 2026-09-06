import { Navigate } from 'react-router-dom';
import { useAdminAuth } from './AdminAuthContext';

export default function RequireAdmin({ children }: { children: React.ReactElement }) {
  const { admin, loading } = useAdminAuth();

  if (loading) {
    return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-white/50 text-sm">Loading…</div>;
  }
  if (!admin) {
    return <Navigate to="/admin/login" replace />;
  }
  return children;
}
