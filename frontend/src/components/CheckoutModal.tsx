import { useEffect, useState } from 'react';
import type { CartItem } from '../types';
import { api } from '../api';
import { mediaUrl } from '../config';
import { X, LogIn, UserPlus, CheckCircle2 } from 'lucide-react';

interface Props {
  items: CartItem[];
  /** User dismissed the modal without completing checkout — resume watching, keep the cart. */
  onCancel: () => void;
  /** Checkout completed and the user chose to continue watching — clear the cart, resume watching. */
  onComplete: () => void;
}

type Stage = 'checking' | 'auth' | 'confirm' | 'processing' | 'success' | 'error';
type AuthMode = 'login' | 'register';

export default function CheckoutModal({ items, onCancel, onComplete }: Props) {
  const [stage, setStage] = useState<Stage>('checking');
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);

  // On open, find out whether this browser session already has a
  // linked marketplace account — if so, skip straight to confirming
  // the order instead of asking the viewer to log in again.
  useEffect(() => {
    let cancelled = false;
    api
      .marketplaceAccount()
      .then((res) => {
        if (cancelled) return;
        setStage(res.linked ? 'confirm' : 'auth');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not reach the marketplace');
        setStage('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runCheckout() {
    setStage('processing');
    setError(null);
    try {
      const result = await api.marketplaceCheckout(
        items.map((i) => ({ productId: i.productId, quantity: i.quantity }))
      );
      setOrderId(result.orderId);
      setStage('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
      setStage('error');
    }
  }

  async function submitAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Email and password are required');
      return;
    }
    setStage('processing');
    setError(null);
    try {
      if (authMode === 'login') {
        await api.marketplaceLogin(email.trim(), password);
      } else {
        await api.marketplaceRegister(email.trim(), password, name.trim() || undefined);
      }
      // Linked — go straight into checkout rather than making the
      // viewer press another button.
      await runCheckout();
    } catch (err) {
      setError(err instanceof Error ? err.message : authMode === 'login' ? 'Login failed' : 'Registration failed');
      setStage('auth');
    }
  }

  const total = items.length;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center sm:justify-center bg-black/70">
      <div className="safe-bottom safe-left safe-right modal-max-h-90 w-full sm:max-w-md bg-neutral-900 rounded-t-2xl sm:rounded-2xl overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-white font-semibold text-sm">Checkout</span>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close checkout"
            disabled={stage === 'processing'}
            className="tap-target -mr-2 text-white/60 disabled:opacity-30"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Order summary — shown for every stage except the final success screen */}
          {stage !== 'success' && (
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {items.map((item) => (
                <div key={item.productId} className="flex items-center gap-3">
                  <img src={mediaUrl(item.image)} alt={item.name} className="w-10 h-10 rounded object-cover bg-white/10" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-medium truncate">{item.name}</p>
                    <p className="text-white/50 text-[11px]">Qty {item.quantity}</p>
                  </div>
                  <span className="text-brand-cyan text-xs font-semibold">{item.price}</span>
                </div>
              ))}
            </div>
          )}

          {stage === 'checking' && <p className="text-white/60 text-sm text-center py-6">Checking your account…</p>}

          {stage === 'auth' && (
            <form onSubmit={submitAuth} className="space-y-3">
              <div className="flex rounded-lg bg-white/10 p-1">
                <button
                  type="button"
                  onClick={() => setAuthMode('login')}
                  className={`flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-medium ${
                    authMode === 'login' ? 'bg-white text-black' : 'text-white/60'
                  }`}
                >
                  <LogIn size={14} /> Log in
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('register')}
                  className={`flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-medium ${
                    authMode === 'register' ? 'bg-white text-black' : 'text-white/60'
                  }`}
                >
                  <UserPlus size={14} /> Register
                </button>
              </div>

              <p className="text-white/50 text-xs">Log in to the marketplace to complete checkout.</p>

              {authMode === 'register' && (
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name (optional)"
                  className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/40"
                />
              )}
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="Email"
                className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/40"
              />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="Password"
                className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/40"
              />

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <button
                type="submit"
                className="w-full bg-blue-600 text-white font-semibold text-sm rounded-lg py-2.5"
              >
                {authMode === 'login' ? 'Log in and checkout' : 'Register and checkout'}
              </button>
            </form>
          )}

          {stage === 'confirm' && (
            <div className="space-y-3">
              <p className="text-white/50 text-xs">Your marketplace account is linked. Confirm to place the order.</p>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                type="button"
                onClick={runCheckout}
                className="w-full bg-blue-600 text-white font-semibold text-sm rounded-lg py-2.5"
              >
                Confirm checkout ({total} item{total === 1 ? '' : 's'})
              </button>
            </div>
          )}

          {stage === 'processing' && <p className="text-white/60 text-sm text-center py-6">Processing…</p>}

          {stage === 'error' && (
            <div className="space-y-3">
              <p className="text-red-400 text-sm text-center">{error || 'Something went wrong.'}</p>
              <button
                type="button"
                onClick={() => setStage('confirm')}
                className="w-full bg-white/10 text-white font-semibold text-sm rounded-lg py-2.5"
              >
                Try again
              </button>
            </div>
          )}

          {stage === 'success' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 size={40} className="text-green-400" />
              <p className="text-white font-semibold text-sm">Order placed</p>
              {orderId && <p className="text-white/50 text-xs">Order #{orderId}</p>}
              <button
                type="button"
                onClick={onComplete}
                className="w-full bg-blue-600 text-white font-semibold text-sm rounded-lg py-2.5 mt-2"
              >
                Continue watching
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
