import { useState } from 'react';
import type { VisualSearchResult } from '../types';
import { mediaUrl } from '../config';
import ImageLightbox from './ImageLightbox';
import { X, ShoppingCart, Check, SearchX, Search, Images, ImageOff } from 'lucide-react';

interface Props {
  loading: boolean;
  error: string | null;
  results: VisualSearchResult[] | null;
  identification?: string | null;
  /** Which query actually produced results, when it differs from what was
   *  originally identified/typed (the marketplace's search shortens a
   *  multi-word phrase until something matches — see backend/src/lib/marketplace.ts). */
  matchedQuery?: string | null;
  cartProductIds: Set<string>;
  onAddToCart: (result: VisualSearchResult) => void;
  onRemoveFromCart: (productId: string) => void;
  /** Manual, user-typed search — independent of the AI crop-to-identify flow.
   *  Doubles as a way to directly verify whether an item exists on the
   *  marketplace at all. */
  onManualSearch: (query: string) => void;
  onClose: () => void;
}

export default function SearchResultsPanel({
  loading,
  error,
  results,
  identification,
  matchedQuery,
  cartProductIds,
  onAddToCart,
  onRemoveFromCart,
  onManualSearch,
  onClose,
}: Props) {
  const [manualQuery, setManualQuery] = useState('');
  const [lightbox, setLightbox] = useState<{ images: string[]; title: string } | null>(null);
  // Tracks which result ids had their primary image fail to load (e.g. a
  // dead/expired CDN URL from the marketplace) so those show a clear
  // "photo unavailable" state instead of a blank/broken image icon.
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());

  function submitManualSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = manualQuery.trim();
    if (trimmed) onManualSearch(trimmed);
  }

  const showShortenedNotice = matchedQuery && identification && matchedQuery !== identification;

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

      {/* Manual text search — usable at any time, whether or not an AI
          crop-search has run yet. Lets a viewer type their own words and
          verify directly whether the marketplace carries something. */}
      <form onSubmit={submitManualSearch} className="px-4 pb-3 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 bg-white/10 rounded-full px-3 py-2">
          <Search size={16} className="text-white/40 shrink-0" />
          <input
            value={manualQuery}
            onChange={(e) => setManualQuery(e.target.value)}
            placeholder="Or type to search the marketplace…"
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-white/40 min-w-0"
          />
        </div>
        <button
          type="submit"
          disabled={!manualQuery.trim()}
          className="tap-target shrink-0 px-3 py-2 rounded-full bg-brand-cyan text-black text-xs font-semibold disabled:opacity-30"
        >
          Search
        </button>
      </form>

      <div className="safe-bottom safe-left safe-right flex-1 overflow-y-auto px-4 pb-6">
        {loading && <p className="text-white/60 text-sm mt-8 text-center">Searching…</p>}
        {error && <p className="text-red-400 text-sm mt-8 text-center">{error}</p>}
        {!loading && !error && showShortenedNotice && (
          <p className="text-white/40 text-[11px] text-center mb-2">Matched using the shorter term "{matchedQuery}"</p>
        )}
        {!loading && !error && results && results.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center mt-16 gap-3">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
              <SearchX size={28} className="text-white/30" />
            </div>
            <div>
              <p className="text-white/80 text-sm font-medium">No matches found</p>
              {identification ? (
                <p className="text-white/40 text-xs mt-1">
                  Nothing matching "{identification}" turned up on the marketplace, even after trying shorter and
                  partial versions of it.
                </p>
              ) : (
                <p className="text-white/40 text-xs mt-1">Try a different word, or mark a clearer view of the item.</p>
              )}
            </div>
          </div>
        )}
        {!loading && !error && results && results.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-2">
            {results.map((r) => {
              const inCart = cartProductIds.has(r.id);
              const images = r.images && r.images.length > 0 ? r.images : r.image ? [r.image] : [];
              const imageBroken = brokenImages.has(r.id);
              return (
                <div key={r.id} className="bg-white/5 rounded-lg overflow-hidden flex flex-col">
                  <button
                    type="button"
                    onClick={() => images.length > 0 && !imageBroken && setLightbox({ images, title: r.name })}
                    disabled={images.length === 0 || imageBroken}
                    aria-label={images.length > 0 ? `View photo${images.length > 1 ? 's' : ''} of ${r.name}` : undefined}
                    className="relative w-full aspect-square bg-white/5"
                  >
                    {images.length > 0 && !imageBroken ? (
                      <img
                        src={mediaUrl(images[0])}
                        alt={r.name}
                        loading="lazy"
                        className="w-full h-full object-cover"
                        onError={() => setBrokenImages((prev) => new Set(prev).add(r.id))}
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-white/20 text-[10px]">
                        <ImageOff size={18} />
                        {imageBroken ? 'Photo unavailable' : 'No photo'}
                      </div>
                    )}
                    {images.length > 1 && (
                      <span className="absolute bottom-1 right-1 flex items-center gap-0.5 bg-black/60 rounded-full px-1.5 py-0.5 text-[10px] text-white">
                        <Images size={10} /> {images.length}
                      </span>
                    )}
                  </button>
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
                        onClick={() => (inCart ? onRemoveFromCart(r.id) : onAddToCart(r))}
                        className={`mt-2 flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-semibold ${
                          inCart ? 'bg-white/10 text-white/60' : 'bg-blue-600 text-white'
                        }`}
                      >
                        {inCart ? (
                          <>
                            <Check size={12} /> Added — tap to remove
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

      {lightbox && (
        <ImageLightbox images={lightbox.images} initialIndex={0} title={lightbox.title} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
