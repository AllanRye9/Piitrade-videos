import { useState } from 'react';
import type { VisualSearchResult } from '../types';
import { mediaUrl, piitradeUrl } from '../config';
import { X, SearchX, Search, ImageOff, MapPin, BadgeCheck, ExternalLink, ShieldCheck } from 'lucide-react';

interface Props {
  loading: boolean;
  error: string | null;
  results: VisualSearchResult[] | null;
  identification?: string | null;
  /** Which query actually produced results, when it differs from what was
   *  originally identified/typed (the marketplace's search shortens a
   *  multi-word phrase until something matches — see backend/src/lib/marketplace.ts). */
  matchedQuery?: string | null;
  /** "See all results" on piitrade.com. */
  browseUrl?: string | null;
  /** Manual, user-typed search — independent of the AI crop-to-identify flow.
   *  Doubles as a way to directly verify whether an item exists on the
   *  marketplace at all. */
  onManualSearch: (query: string) => void;
  onClose: () => void;
}

/** A listing's image, with its own load-error state so one broken CDN
 *  link degrades to a placeholder instead of the browser's broken-image
 *  icon — each instance tracks only its own failure. */
function ListingImage({ src, alt }: { src: string | undefined; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="w-20 h-20 shrink-0 rounded-lg bg-white/5 flex items-center justify-center">
        <ImageOff size={20} className="text-white/25" />
      </div>
    );
  }
  return <img src={src} alt={alt} onError={() => setFailed(true)} loading="lazy" className="w-20 h-20 shrink-0 rounded-lg object-cover bg-white/5" />;
}

/**
 * "Found on Piitrade" — bottom sheet of classifieds listings matching
 * what the viewer marked in the video (or typed). piitrade.com is a
 * classifieds marketplace, so there's no cart: each card simply opens
 * the listing on piitrade.com, where the viewer contacts the seller.
 * It's a sheet, not a full screen, so the paused video stays visible
 * above it.
 */
export default function SearchResultsPanel({ loading, error, results, identification, matchedQuery, browseUrl, onManualSearch, onClose }: Props) {
  const [manualQuery, setManualQuery] = useState('');

  function submitManualSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = manualQuery.trim();
    if (trimmed) onManualSearch(trimmed);
  }

  const showShortenedNotice = matchedQuery && identification && matchedQuery !== identification;
  const seeAllUrl = browseUrl || piitradeUrl('/listings');

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/60" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-sheet-in safe-left safe-right flex flex-col w-full sm:max-w-md bg-neutral-900 rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{ maxHeight: '72vh' }}
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold">Find on Piitrade</p>
            {identification && <p className="text-[11px] text-white/50 truncate">Looks like “{identification}”</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close results" className="tap-target -mr-2 -mt-1 text-white/60 shrink-0">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submitManualSearch} className="px-4 pb-3 flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 bg-white/10 rounded-full px-3 py-2 focus-within:ring-2 focus-within:ring-brand-amber">
            <Search size={16} className="text-white/40 shrink-0" />
            <input
              value={manualQuery}
              onChange={(e) => setManualQuery(e.target.value)}
              placeholder="Search piitrade.com…"
              className="flex-1 bg-transparent text-white text-sm outline-none focus-visible:outline-none placeholder:text-white/40 min-w-0"
            />
          </div>
          <button
            type="submit"
            disabled={!manualQuery.trim()}
            className="shrink-0 h-9 px-4 rounded-full bg-brand-orange text-white text-xs font-semibold disabled:opacity-30"
          >
            Search
          </button>
        </form>

        <div className="flex-1 overflow-y-auto px-4 pb-3">
          {loading && <p className="text-white/60 text-sm py-10 text-center">Searching Piitrade…</p>}
          {error && <p className="text-red-400 text-sm py-10 text-center">{error}</p>}

          {!loading && !error && showShortenedNotice && (
            <p className="text-white/40 text-[11px] text-center mb-2">Showing matches for “{matchedQuery}”</p>
          )}

          {!loading && !error && results && results.length === 0 && (
            <div className="flex flex-col items-center text-center py-8 gap-3">
              <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center">
                <SearchX size={26} className="text-white/30" />
              </div>
              <div>
                <p className="text-white/80 text-sm font-medium">No listings found</p>
                <p className="text-white/40 text-xs mt-1">
                  {identification ? `Nothing like “${identification}” is listed right now.` : 'Try a different word, or mark a clearer view of the item.'}
                </p>
              </div>
            </div>
          )}

          {!loading && !error && results && results.length > 0 && (
            <ul className="space-y-2">
              {results.map((r) => (
                <li key={r.id}>
                  <a
                    href={r.listingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex gap-3 rounded-xl bg-white/5 hover:bg-white/10 p-2.5"
                  >
                    <ListingImage src={mediaUrl(r.image)} alt={r.name} />
                    <div className="min-w-0 flex-1 flex flex-col">
                      <p className="text-white text-sm font-medium line-clamp-2 leading-snug">{r.name}</p>
                      <p className="mt-1 flex items-baseline gap-2">
                        <span className="text-brand-orange text-sm font-bold">{r.price}</span>
                        {r.originalPrice && <span className="text-white/35 text-[11px] line-through">{r.originalPrice}</span>}
                      </p>
                      <p className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-white/50">
                        {r.location && (
                          <span className="flex items-center gap-0.5">
                            <MapPin size={11} /> {r.location}
                          </span>
                        )}
                        {r.condition && <span>{r.condition}</span>}
                        {r.storeName && <span className="truncate max-w-[8rem]">{r.storeName}</span>}
                        {r.verifiedSeller && (
                          <span className="flex items-center gap-0.5 text-brand-amber">
                            <BadgeCheck size={12} /> Verified
                          </span>
                        )}
                      </p>
                    </div>
                    <ExternalLink size={14} className="text-white/30 shrink-0 mt-1" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="safe-bottom border-t border-white/10 px-4 pt-3 pb-3 space-y-2">
          <a
            href={seeAllUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full rounded-full border border-brand-orange text-brand-orange text-sm font-semibold py-2.5 hover:bg-brand-orange/10"
          >
            See all on piitrade.com <ExternalLink size={14} />
          </a>
          <p className="flex items-center justify-center gap-1 text-[11px] text-white/35">
            <ShieldCheck size={12} /> Meet in public and inspect before paying.
          </p>
        </div>
      </div>
    </div>
  );
}
