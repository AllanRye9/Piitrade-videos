import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  X,
  Plus,
  Compass,
  Settings as SettingsIcon,
  Bell,
  User,
  ExternalLink,
  Store,
  ShieldCheck,
  PlusCircle,
} from 'lucide-react';
import Avatar from './Avatar';
import { ensureProfileLoaded, getProfileState, subscribeProfile } from '../profileStore';
import { piitradeUrl } from '../config';

export type FeedMode = 'latest' | 'trending';

interface Props {
  mode: FeedMode;
  onModeChange: (mode: FeedMode) => void;
  onSearch: (query: string) => void;
  onUploadClick: () => void;
  onSettingsClick: () => void;
  onNotificationsClick: () => void;
  unreadCount: number;
}

const TABS: Array<{ id: FeedMode; label: string }> = [
  { id: 'latest', label: 'Latest' },
  { id: 'trending', label: 'Trending' },
];

/**
 * The app's only chrome above the video: a slim, SOLID bar that sits
 * beside the video stage rather than on top of it, so nothing here
 * ever covers a frame. It holds the Latest/Trending switcher (these
 * used to float over the video), search, upload, and one account menu
 * that now holds everything that used to be its own icon button
 * (notifications, discover, settings, profile) plus the shortcuts to
 * piitrade.com.
 */
export default function TopBar({ mode, onModeChange, onSearch, onUploadClick, onSettingsClick, onNotificationsClick, unreadCount }: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const profile = useSyncExternalStore(subscribeProfile, getProfileState);

  useEffect(() => {
    ensureProfileLoaded();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearch(query.trim()), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  // Close the account menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent | TouchEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  function closeSearch() {
    setQuery('');
    setSearchOpen(false);
  }

  const menuItem = 'flex items-center gap-3 w-full px-4 py-2.5 text-sm text-white/90 hover:bg-white/5 text-left';

  return (
    <header className="safe-top safe-left safe-right relative z-30 shrink-0 bg-neutral-950 border-b border-white/5">
      <div className="mx-auto flex h-12 sm:h-14 max-w-5xl items-center gap-2 px-3">
        {searchOpen ? (
          <>
            <div className="relative flex-1 min-w-0">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/50" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search videos…"
                autoComplete="off"
                inputMode="search"
                aria-label="Search videos"
                className="w-full min-w-0 bg-white/10 text-white text-sm rounded-full pl-9 pr-9 py-2 outline-none placeholder:text-white/50"
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
            <button type="button" onClick={closeSearch} className="shrink-0 px-2 py-2 text-sm font-medium text-white/80">
              Cancel
            </button>
          </>
        ) : (
          <>
            <Link to="/" aria-label="Piitrade Videos home" className="flex items-center gap-2 shrink-0">
              <span className="w-8 h-8 rounded-lg bg-brand-orange flex items-center justify-center text-white font-extrabold text-lg leading-none">
                P
              </span>
              <span className="hidden sm:inline text-white font-bold text-[15px] tracking-tight">
                Piitrade <span className="text-white/50 font-semibold">Videos</span>
              </span>
            </Link>

            {/* Latest / Trending live here, in the bar — never on the video. */}
            <div role="tablist" aria-label="Feed" className="flex flex-1 items-center justify-center gap-5 sm:gap-8 min-w-0">
              {TABS.map((tab) => {
                const active = mode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onModeChange(tab.id)}
                    className={`relative h-12 sm:h-14 text-sm font-semibold ${active ? 'text-white' : 'text-white/50 hover:text-white/80'}`}
                  >
                    {tab.label}
                    {active && <span className="absolute bottom-0 inset-x-0 h-0.5 rounded-full bg-brand-orange" />}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search videos"
              className="tap-target shrink-0 w-9 h-9 min-w-0 min-h-0 rounded-full flex items-center justify-center text-white/80 hover:bg-white/10"
            >
              <Search size={20} />
            </button>

            <button
              type="button"
              onClick={onUploadClick}
              aria-label="Upload a video"
              className="shrink-0 h-9 rounded-full bg-brand-orange text-white text-sm font-semibold flex items-center justify-center gap-1.5 w-9 sm:w-auto sm:px-4"
            >
              <Plus size={18} />
              <span className="hidden sm:inline">Upload</span>
            </button>

            <div ref={menuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label={unreadCount > 0 ? `Account menu, ${unreadCount} unread notifications` : 'Account menu'}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="relative w-9 h-9 rounded-full bg-white/10 border border-white/10 flex items-center justify-center"
              >
                <Avatar src={profile.avatar} size={28} alt="Your profile" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-brand-orange text-white text-[10px] font-bold flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  className="animate-dialog-in absolute right-0 top-full mt-2 w-64 rounded-xl bg-neutral-900 border border-white/10 shadow-2xl shadow-black/60 py-1.5 overflow-hidden"
                >
                  <Link role="menuitem" to="/profile" onClick={() => setMenuOpen(false)} className={menuItem}>
                    <User size={18} className="text-white/50" /> Your profile
                  </Link>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onNotificationsClick();
                    }}
                    className={menuItem}
                  >
                    <Bell size={18} className="text-white/50" />
                    <span className="flex-1">Notifications</span>
                    {unreadCount > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-brand-orange text-white text-[11px] font-bold flex items-center justify-center">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </button>
                  <Link role="menuitem" to="/discover" onClick={() => setMenuOpen(false)} className={menuItem}>
                    <Compass size={18} className="text-white/50" /> Discover creators
                  </Link>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onSettingsClick();
                    }}
                    className={menuItem}
                  >
                    <SettingsIcon size={18} className="text-white/50" /> Settings
                  </button>

                  <div className="my-1.5 border-t border-white/10" />
                  <p className="px-4 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-white/35">On piitrade.com</p>
                  <a role="menuitem" href={piitradeUrl('/listings')} target="_blank" rel="noopener noreferrer" className={menuItem}>
                    <Store size={18} className="text-brand-orange" />
                    <span className="flex-1">Browse listings</span>
                    <ExternalLink size={14} className="text-white/30" />
                  </a>
                  <a role="menuitem" href={piitradeUrl('/listings/create')} target="_blank" rel="noopener noreferrer" className={menuItem}>
                    <PlusCircle size={18} className="text-brand-orange" />
                    <span className="flex-1">Sell something</span>
                    <ExternalLink size={14} className="text-white/30" />
                  </a>
                  <a role="menuitem" href={piitradeUrl('/safety')} target="_blank" rel="noopener noreferrer" className={menuItem}>
                    <ShieldCheck size={18} className="text-brand-orange" />
                    <span className="flex-1">Safety tips</span>
                    <ExternalLink size={14} className="text-white/30" />
                  </a>

                  <div className="mt-1.5 border-t border-white/10 px-4 pt-2 pb-1.5 flex items-center gap-3 text-[11px] text-white/35">
                    <Link to="/legal/terms" onClick={() => setMenuOpen(false)} className="hover:text-white/60">
                      Terms
                    </Link>
                    <Link to="/legal/privacy" onClick={() => setMenuOpen(false)} className="hover:text-white/60">
                      Privacy
                    </Link>
                    <Link to="/legal/dmca" onClick={() => setMenuOpen(false)} className="hover:text-white/60">
                      Copyright
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </header>
  );
}
