import { useEffect, useRef, useState } from 'react';

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
    <div className="absolute top-0 inset-x-0 z-30 flex items-center gap-2 px-3 py-3 bg-gradient-to-b from-black/60 to-transparent">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search videos…"
        autoComplete="off"
        className="flex-1 bg-white/10 text-white text-sm rounded-full px-4 py-2 outline-none placeholder:text-white/50"
      />
      <button
        onClick={onUploadClick}
        className="shrink-0 bg-brand-pink text-white text-sm font-semibold rounded-full px-3 py-2"
      >
        Upload
      </button>
    </div>
  );
}
