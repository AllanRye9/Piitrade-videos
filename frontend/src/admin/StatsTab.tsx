import { useEffect, useState } from 'react';
import { adminApi } from '../api';
import type { AdminStats } from '../types';

export default function StatsTab() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .stats()
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load stats'));
  }, []);

  if (error) return <p className="text-red-400 text-sm">{error}</p>;
  if (!stats) return <p className="text-white/50 text-sm">Loading…</p>;

  const cards: Array<{ label: string; value: number }> = [
    { label: 'Videos', value: stats.videos },
    { label: 'Comments', value: stats.comments },
    { label: 'Products', value: stats.products },
    { label: 'Total views', value: stats.totalViews },
    { label: 'Total likes', value: stats.totalLikes },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-white/5 rounded-xl p-4">
          <p className="text-white/50 text-xs">{c.label}</p>
          <p className="text-white text-2xl font-semibold mt-1">{c.value.toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}
