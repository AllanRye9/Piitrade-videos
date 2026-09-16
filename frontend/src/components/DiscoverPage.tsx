import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AccountSummary } from '../types';
import { api } from '../api';
import Avatar from './Avatar';
import { ArrowLeft, Search, X, Film, Heart } from 'lucide-react';

export default function DiscoverPage() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function load(q: string) {
    setLoading(true);
    setError(null);
    api
      .discoverAccounts(q || undefined)
      .then((res) => setAccounts(res.accounts))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load accounts'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(query.trim()), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="h-dvh w-full bg-black flex flex-col overflow-hidden">
      <div className="safe-top safe-left safe-right flex items-center gap-3 px-3 py-3 border-b border-white/10 shrink-0">
        <Link to="/" aria-label="Back to feed" className="tap-target -ml-2 text-white flex items-center justify-center">
          <ArrowLeft size={22} />
        </Link>
        <h1 className="text-white font-semibold text-base">Discover creators</h1>
      </div>

      <div className="px-3 sm:px-4 py-3 shrink-0">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search creators…"
            autoComplete="off"
            inputMode="search"
            aria-label="Search creators"
            className="w-full bg-white/10 text-white text-sm rounded-full pl-9 pr-9 py-2.5 outline-none placeholder:text-white/50"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-white/60"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-4 pb-6">
        {loading && <p className="text-white/50 text-sm text-center mt-10">Loading…</p>}
        {!loading && error && <p className="text-white/60 text-sm text-center mt-10">{error}</p>}
        {!loading && !error && accounts.length === 0 && (
          <p className="text-white/50 text-sm text-center mt-10 px-6">No creators to discover yet.</p>
        )}
        {!loading && !error && accounts.length > 0 && (
          <div className="flex flex-col gap-1">
            {accounts.map((a) => (
              <Link
                key={a.handle}
                to={`/u/${a.handle}`}
                className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-white/5"
              >
                <Avatar src={a.avatar} size={44} alt={a.handle} />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{a.displayName || `@${a.handle}`}</p>
                  <p className="text-white/40 text-xs truncate">@{a.handle}</p>
                </div>
                <div className="flex flex-col items-end text-white/60 text-[11px] gap-0.5 shrink-0">
                  <span className="flex items-center gap-1">
                    <Film size={11} /> {a.videoCount}
                  </span>
                  <span className="flex items-center gap-1">
                    <Heart size={11} /> {a.totalLikes}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
