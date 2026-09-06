import type { VisualSearchResult } from '../types';

interface Props {
  loading: boolean;
  error: string | null;
  results: VisualSearchResult[] | null;
  onClose: () => void;
}

export default function SearchResultsPanel({ loading, error, results, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      <div className="safe-top flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm font-semibold">Similar items</span>
        <button onClick={onClose} className="tap-target -mr-2 text-sm text-white/70">
          Close
        </button>
      </div>
      <div className="safe-bottom safe-left safe-right flex-1 overflow-y-auto px-4 pb-6">
        {loading && <p className="text-white/60 text-sm mt-8 text-center">Searching…</p>}
        {error && <p className="text-red-400 text-sm mt-8 text-center">{error}</p>}
        {!loading && !error && results && results.length === 0 && (
          <p className="text-white/60 text-sm mt-8 text-center">No similar products found.</p>
        )}
        {!loading && !error && results && results.length > 0 && (
          <div className="grid grid-cols-2 gap-3 mt-2">
            {results.map((r) => (
              <div key={r.id} className="bg-white/5 rounded-lg overflow-hidden">
                <img src={r.image} alt={r.name} className="w-full aspect-square object-cover" />
                <div className="p-2">
                  <p className="text-white text-xs font-medium line-clamp-2">{r.name}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-brand-cyan text-xs font-semibold">{r.price}</span>
                    <span className="text-white/50 text-[10px]">{r.match}% match</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
