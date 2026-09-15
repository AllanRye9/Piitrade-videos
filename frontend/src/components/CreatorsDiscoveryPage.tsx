import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Creator } from '../types';
import Avatar from './Avatar';
import { ArrowLeft, Heart, Eye } from 'lucide-react';

export default function CreatorsDiscoveryPage() {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listCreators()
      .then((res) => setCreators(res.creators))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load creators'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="h-dvh w-full bg-black sm:bg-neutral-950 flex items-center justify-center overflow-hidden">
      <div className="relative h-full w-full sm:h-[94dvh] sm:max-h-[900px] sm:w-[420px] sm:rounded-2xl sm:overflow-hidden sm:shadow-2xl sm:shadow-black/60 bg-black flex flex-col">
        <div className="safe-top flex items-center gap-3 px-3 py-3 border-b border-white/10 shrink-0">
          <Link to="/" aria-label="Back to feed" className="tap-target -ml-2 text-white flex items-center justify-center">
            <ArrowLeft size={22} />
          </Link>
          <h1 className="text-white font-semibold text-base">Discover creators</h1>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <p className="text-white/60 text-sm text-center py-16">Loading…</p>}
          {!loading && error && <p className="text-white/60 text-sm text-center py-16 px-6">{error}</p>}
          {!loading && !error && creators.length === 0 && (
            <p className="text-white/60 text-sm text-center py-16 px-6">No one has uploaded a video yet.</p>
          )}

          {!loading && !error && creators.length > 0 && (
            <div className="divide-y divide-white/10">
              {creators.map((c) => (
                <Link key={c.sessionId} to={`/creator/${c.sessionId}`} className="flex items-center gap-3 px-4 py-3">
                  <Avatar src={c.avatar} size={44} alt={c.displayName || 'Creator'} />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{c.displayName || 'Unnamed creator'}</p>
                    <p className="text-white/50 text-xs">
                      {c.videoCount} video{c.videoCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-white/50 text-xs shrink-0">
                    <span className="flex items-center gap-1">
                      <Heart size={12} /> {c.totalLikes}
                    </span>
                    <span className="flex items-center gap-1">
                      <Eye size={12} /> {c.totalViews}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
