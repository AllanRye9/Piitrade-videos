import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAdminAuth } from './AdminAuthContext';
import { adminApi } from './adminApi';
import { useFetch } from './hooks';
import { ADMIN_BASE } from './paths';
import AuthShell from './AuthShell';
import { Button, Field, Spinner, inputCls } from './ui';

/** One-time setup: the first account registered here becomes the primary admin. */
export default function AdminRegister() {
  const { admin, register } = useAdminAuth();
  const navigate = useNavigate();
  const setup = useFetch(() => adminApi.setupStatus(), []);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (admin) return <Navigate to={ADMIN_BASE} replace />;
  if (setup.loading) return <div className="min-h-screen bg-neutral-950"><Spinner /></div>;
  // Registration is closed once an admin exists — additional admins are created by the primary admin.
  if (setup.data && !setup.data.needsSetup) return <Navigate to={`${ADMIN_BASE}/login`} replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await register({ email, password, name: name || undefined, setupCode: setupCode || undefined });
      navigate(ADMIN_BASE, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Create the primary admin" subtitle="You’re the first one here, so this account gets full control. You can add other admins and choose their permissions afterwards.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={inputCls} />
        </Field>
        <Field label="Email">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" className={inputCls} />
        </Field>
        <Field label="Password" hint="At least 8 characters">
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={inputCls} />
        </Field>
        <Field label="Confirm password">
          <input type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className={inputCls} />
        </Field>
        {setup.data?.requiresSetupCode && (
          <Field label="Setup code" hint="The ADMIN_SETUP_CODE configured on the server">
            <input required value={setupCode} onChange={(e) => setSetupCode(e.target.value)} className={inputCls} />
          </Field>
        )}
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <Button type="submit" variant="primary" loading={loading} className="w-full">
          Create primary admin
        </Button>
      </form>
      <p className="text-white/50 text-xs text-center">
        Already set up?{' '}
        <Link to={`${ADMIN_BASE}/login`} className="text-brand-amber font-semibold">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
