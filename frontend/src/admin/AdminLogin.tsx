import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAdminAuth } from './AdminAuthContext';
import { adminApi } from './adminApi';
import { useFetch } from './hooks';
import { ADMIN_BASE } from './paths';
import AuthShell from './AuthShell';
import { Button, Field, inputCls } from './ui';

export default function AdminLogin() {
  const { admin, login } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // "Register" is only offered while no admin exists yet (first-run setup).
  const setup = useFetch(() => adminApi.setupStatus(), []);

  const from = (location.state as { from?: string } | null)?.from;
  if (admin) return <Navigate to={from && from.startsWith(ADMIN_BASE) ? from : ADMIN_BASE} replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate(from && from.startsWith(ADMIN_BASE) ? from : ADMIN_BASE, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Sign in" subtitle="Admin dashboard access only.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Email">
          <input type="email" required autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Password">
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
        </Field>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <Button type="submit" variant="primary" loading={loading} className="w-full">
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      {setup.data?.needsSetup ? (
        <p className="text-white/50 text-xs text-center">
          No admin exists yet.{' '}
          <Link to={`${ADMIN_BASE}/register`} className="text-brand-amber font-semibold">
            Register the first (primary) admin
          </Link>
        </p>
      ) : (
        <p className="text-white/35 text-xs text-center">Need an account? Ask the primary admin to create one for you.</p>
      )}
    </AuthShell>
  );
}
