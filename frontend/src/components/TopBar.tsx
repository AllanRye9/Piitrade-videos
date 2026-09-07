import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, X, CircleUserRound } from 'lucide-react';

interface Props {
  onSearch: (query: string) => void;
  onUploadClick: () => void;
}

export default function TopBar({ onSearch, onUploadClick }: Props) {
  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearch(query.trim()), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="safe-top safe-left safe-right absolute top-0 inset-x-0 z-30 flex items-center gap-2 px-3 py-3 bg-gradient-to-b from-black/60 to-transparent">
      <div className="relative flex-1 min-w-0">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/50" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search videos…"
          autoComplete="off"
          inputMode="search"
          aria-label="Search videos"
          className="w-full min-w-0 bg-white/10 text-white text-sm rounded-full pl-9 pr-9 py-2.5 outline-none placeholder:text-white/50"
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

      {/* Upload and Profile sit side by side, same height, so the
          circular Profile button reads as "uniform in size" to the
          pill-shaped Upload button next to it rather than looking
          mismatched. */}
      <button
        type="button"
        onClick={onUploadClick}
        className="tap-target shrink-0 h-11 bg-brand-pink text-white text-sm font-semibold rounded-full px-4"
      >
        Upload
      </button>
      <Link
        to="/profile"
        aria-label="Open your profile"
        className="tap-target shrink-0 h-11 w-11 rounded-full bg-white/10 text-white flex items-center justify-center border border-white/10"
      >
        <CircleUserRound size={24} />
      </Link>
    </div>
  );
}
