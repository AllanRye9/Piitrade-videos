import type { VisualSearchResult } from '../types';
import { mediaUrl } from '../config';
import { X, ShoppingCart, Check, PackageSearch, ImageOff } from 'lucide-react';

interface Props {
  loading: boolean;
  error: string | null;
  results: VisualSearchResult[] | null;
  identification?: string | null;
  /** Backend's regex/chunk fuzzy-match verdict — whether the
   *  identified item exists anywhere in the marketplace. Distinct from
   *  `results.length === 0` for messaging purposes: a search that
   *  legitimately found nothing gets a more specific empty state than
   *  a generic "no results" message. */
  exists?: boolean;
  cartProductIds: Set<string>;
  onAddToCart: (result: VisualSearchResult) => void;
  onClose: () => void;
}

function matchTone(match: number): string {
  if (match >= 60) return 'bg-emerald-500/90 text-white';
  if (match >= 25) return 'bg-amber-500/90 text-white';
  return 'bg-white/15 text-white/70';
}

export default function SearchResultsPanel({
  loading,
  error,
  results,
  identification,
  exists,
  cartProductIds,
  onAddToCart,
  onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/92 backdrop-blur-sm flex flex-col animate-in fade-in duration-150">
      <div className="safe-top flex items-start justify-between gap-3 px-4 py-3 border-b border-white/10 text-white">
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold tracking-tight">Similar items</span>
          {identification && (
            <span className="text-[11px] text-white/50 truncate">
              Identified as <span className="text-white/70 font-medium">"{identification}"</span>
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search results"
          className="tap-target -mr-2 -mt-1 text-white/70 hover:text-white transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      <div className="safe-bottom safe-left safe-right flex-1 overflow-y-auto px-4 pb-6">
        {loading && (
          <div className="flex flex-col items-center gap-3 mt-16 text-white/60">
            <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-brand-cyan animate-spin" />
            <p className="text-sm">Searching the marketplace…</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-2 mt-16 text-center px-6">
            <p className="text-red-400 text-sm font-medium">{error}</p>
            <p className="text-white/40 text-xs">Try marking the item again, or crop a tighter selection.</p>
          </div>
        )}

        {!loading && !error && results && results.length === 0 && (
          <div className="flex flex-col items-center gap-2 mt-16 text-center px-6">
            <PackageSearch size={32} className="text-white/25" />
            <p className="text-white/70 text-sm font-medium">
              {exists === false ? "This item isn't in the marketplace yet" : 'No similar products found'}
            </p>
            <p className="text-white/40 text-xs max-w-[240px]">
              {identification
                ? `We checked "${identification}" against every listing — no close enough match.`
                : 'Try a tighter crop, or mark a different part of the frame.'}
            </p>
          </div>
        )}

        {!loading && !error && results && results.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-3">
            {results.map((r) => {
              const inCart = cartProductIds.has(r.id);
              return (
                <div
                  key={r.id}
                  className="group bg-white/[0.06] border border-white/10 rounded-xl overflow-hidden flex flex-col transition-colors hover:border-white/20"
                >
                  <div className="relative w-full aspect-square bg-white/5">
                    {r.image ? (
                      <img
                        src={mediaUrl(r.image)}
                        alt={r.name}
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageOff size={20} className="text-white/25" />
                      </div>
                    )}
                    <span
                      className={`absolute top-1.5 left-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none ${matchTone(r.match)}`}
                    >
                      {r.match}% match
                    </span>
                  </div>
                  <div className="p-2.5 flex flex-col flex-1">
                    <p className="text-white text-xs font-medium leading-snug line-clamp-2">{r.name}</p>
                    {r.description && <p className="text-white/45 text-[11px] mt-1 line-clamp-2">{r.description}</p>}
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-brand-cyan text-xs font-semibold">{r.price}</span>
                    </div>
                    {r.inStock === false ? (
                      <span className="mt-2 text-center text-[11px] text-white/40 py-1.5 rounded-md bg-white/5">Out of stock</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onAddToCart(r)}
                        disabled={inCart}
                        className={`mt-2 flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-semibold transition-colors ${
                          inCart ? 'bg-white/10 text-white/40' : 'bg-blue-600 text-white hover:bg-blue-500'
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
