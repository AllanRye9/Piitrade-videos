import type { VisualSearchResult } from '../types';
import { mediaUrl } from '../config';
import { X, ShoppingCart, Check } from 'lucide-react';

interface Props {
  loading: boolean;
  error: string | null;
  results: VisualSearchResult[] | null;
  identification?: string | null;
  cartProductIds: Set<string>;
  onAddToCart: (result: VisualSearchResult) => void;
  onClose: () => void;
}

export default function SearchResultsPanel({
  loading,
  error,
  results,
  identification,
  cartProductIds,
  onAddToCart,
  onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      <div className="safe-top flex items-center justify-between px-4 py-3 text-white">
        <div className="flex flex-col">
          <span className="text-sm font-semibold">Similar items</span>
          {identification && <span className="text-[11px] text-white/50">Identified as "{identification}"</span>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close search results" className="tap-target -mr-2 text-white/70">
          <X size={20} />
        </button>
      </div>
      <div className="safe-bottom safe-left safe-right flex-1 overflow-y-auto px-4 pb-6">
        {loading && <p className="text-white/60 text-sm mt-8 text-center">Searching…</p>}
        {error && <p className="text-red-400 text-sm mt-8 text-center">{error}</p>}
        {!loading && !error && results && results.length === 0 && (
          <p className="text-white/60 text-sm mt-8 text-center">No similar products found.</p>
        )}
        {!loading && !error && results && results.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-2">
            {results.map((r) => {
              const inCart = cartProductIds.has(r.id);
              return (
                <div key={r.id} className="bg-white/5 rounded-lg overflow-hidden flex flex-col">
                  <img src={mediaUrl(r.image)} alt={r.name} className="w-full aspect-square object-cover" />
                  <div className="p-2 flex flex-col flex-1">
                    <p className="text-white text-xs font-medium line-clamp-2">{r.name}</p>
                    {r.description && <p className="text-white/50 text-[11px] mt-1 line-clamp-2">{r.description}</p>}
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-brand-cyan text-xs font-semibold">{r.price}</span>
                      <span className="text-white/50 text-[10px]">{r.match}% match</span>
                    </div>
                    {r.inStock === false ? (
                      <span className="mt-2 text-center text-[11px] text-white/40 py-1.5">Out of stock</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onAddToCart(r)}
                        disabled={inCart}
                        className={`mt-2 flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-semibold ${
                          inCart ? 'bg-white/10 text-white/40' : 'bg-blue-600 text-white'
                        }`}
                      >
                        {inCart ? (
                          <>
                            <Check size={12} /> Added
                          </>
                        ) : (
                          <>
                            <ShoppingCart size={12} /> Add to cart
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
