import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAdminAuth } from './AdminAuthContext';

export default function AdminLogin() {
  const { login } = useAdminAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-neutral-900 rounded-2xl p-6 space-y-4">
        <h1 className="text-white text-lg font-semibold">Admin sign in</h1>

        <div>
          <label className="text-white/60 text-xs">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full mt-1 bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none"
          />
        </div>
        <div>
          <label className="text-white/60 text-xs">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full mt-1 bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none"
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand-pink disabled:opacity-50 text-white font-semibold text-sm rounded-lg py-2.5"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-white/50 text-xs text-center">
          No admin account yet?{' '}
          <Link to="/admin/register" className="text-brand-cyan">
            Register
          </Link>
        </p>
      </form>
    </div>
  );
}
