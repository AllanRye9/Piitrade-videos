import { useState } from 'react';
import { useAdminAuth } from './AdminAuthContext';
import StatsTab from './StatsTab';
import VideosTab from './VideosTab';
import CommentsTab from './CommentsTab';
import ProductsTab from './ProductsTab';

type Tab = 'stats' | 'videos' | 'comments' | 'products';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'stats', label: 'Overview' },
  { id: 'videos', label: 'Videos' },
  { id: 'comments', label: 'Comments' },
  { id: 'products', label: 'Products' },
];

export default function AdminDashboard() {
  const { admin, logout } = useAdminAuth();
  const [tab, setTab] = useState<Tab>('stats');

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-white/10">
        <div className="min-w-0">
          <h1 className="text-white font-semibold">Piitrade admin</h1>
          <p className="text-white/40 text-xs truncate">{admin?.email}</p>
        </div>
        <button onClick={logout} className="tap-target shrink-0 text-white/60 text-sm">
          Log out
        </button>
      </div>

      <div className="flex gap-1 px-4 sm:px-6 pt-3 overflow-x-auto no-scrollbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${
              tab === t.id ? 'bg-brand-pink text-white' : 'text-white/60 bg-white/5'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-6">
        {tab === 'stats' && <StatsTab />}
        {tab === 'videos' && <VideosTab />}
        {tab === 'comments' && <CommentsTab />}
        {tab === 'products' && <ProductsTab />}
      </div>
    </div>
  );
}
