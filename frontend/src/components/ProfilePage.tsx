import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import type { Video } from '../types';
import { api } from '../api';
import { mediaUrl } from '../config';
import VideoCard from './VideoCard';
import Avatar from './Avatar';
import ProfileSettings from './ProfileSettings';
import { ensureProfileLoaded, getProfileState, subscribeProfile, setProfileAvatar } from '../profileStore';
import { getCommentedVideoIds, getRecentSearches, addRecentSearch, clearRecentSearches } from '../profileActivity';
import {
  ArrowLeft,
  Heart,
  Bookmark,
  Download,
  MessageCircle,
  Search as SearchIcon,
  X,
  Play,
  History,
  Camera,
  Loader2,
  Settings as SettingsIcon,
  RefreshCw,
  ImageOff,
} from 'lucide-react';

type TabId = 'liked' | 'favorites' | 'downloads' | 'comments' | 'search';

const TABS: { id: TabId; label: string; icon: typeof Heart }[] = [
  { id: 'liked', label: 'Liked', icon: Heart },
  { id: 'favorites', label: 'Favorites', icon: Bookmark },
  { id: 'downloads', label: 'Downloads', icon: Download },
  { id: 'comments', label: 'Comments', icon: MessageCircle },
  { id: 'search', label: 'Search', icon: SearchIcon },
];

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function VideoThumb({ video, onOpen }: { video: Video; onOpen: (v: Video) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(video)}
      className="group relative aspect-[9/16] w-full overflow-hidden rounded-lg bg-neutral-900 text-left ring-1 ring-white/5 transition-all hover:ring-white/20"
    >
      {video.poster ? (
        <img
          src={mediaUrl(video.poster)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900">
          <Play className="text-white/30" size={28} />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
        <div className="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center">
          <Play size={16} fill="currentColor" className="text-white ml-0.5" />
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent p-2 pt-5">
        <p className="text-white text-xs font-medium line-clamp-2 leading-snug">{video.title || 'Untitled'}</p>
        <div className="flex items-center gap-2.5 mt-1 text-white/70 text-[10px]">
          <span className="flex items-center gap-0.5">
            <Heart size={10} fill={video.liked ? 'currentColor' : 'none'} className={video.liked ? 'text-brand-pink' : ''} />
            {formatCount(video.likes)}
          </span>
          <span className="flex items-center gap-0.5">
            <MessageCircle size={10} /> {formatCount(video.comments)}
          </span>
        </div>
      </div>
    </button>
  );
}

function ThumbSkeleton() {
  return <div className="aspect-[9/16] w-full rounded-lg bg-white/5 animate-pulse" />;
}

function EmptyState({ label, icon: Icon }: { label: string; icon: typeof Heart }) {
  return (
    <div className="flex flex-col items-center gap-2 mt-14 px-6 text-center">
      <Icon size={26} className="text-white/20" />
      <p className="text-white/45 text-sm max-w-[240px]">{label}</p>
    </div>
  );
}

function VideoGrid({
  videos,
  onOpen,
  emptyLabel,
  emptyIcon,
}: {
  videos: Video[];
  onOpen: (v: Video) => void;
  emptyLabel: string;
  emptyIcon: typeof Heart;
}) {
  if (videos.length === 0) return <EmptyState label={emptyLabel} icon={emptyIcon} />;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 px-3 sm:px-4 pb-6">
      {videos.map((v) => (
        <VideoThumb key={v.id} video={v} onOpen={onOpen} />
      ))}
    </div>
  );
}

export default function ProfilePage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('liked');
  const [previewVideo, setPreviewVideo] = useState<Video | null>(null);

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const profile = useSyncExternalStore(subscribeProfile, getProfileState);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Video[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>(getRecentSearches());

  function loadVideos() {
    console.log('[ProfilePage] loading videos');
    setLoading(true);
    setError(null);
    api
      .listVideos()
      .then((res) => {
        console.log(`[ProfilePage] loaded ${res.videos.length} video(s)`);
        setVideos(res.videos);
      })
      .catch((err) => {
        console.error('[ProfilePage] failed to load videos:', err instanceof Error ? err.message : err);
        setError(err instanceof Error ? err.message : 'Failed to load your videos');
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadVideos();
    ensureProfileLoaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAvatarChange(f: File | null) {
    if (!f) return;
    console.log(`[ProfilePage] uploading avatar: ${f.name} (${(f.size / 1024).toFixed(0)}KB)`);
    setAvatarError(null);
    setAvatarUploading(true);
    try {
      const res = await api.uploadAvatar(f);
      console.log('[ProfilePage] avatar updated');
      setProfileAvatar(res.avatar);
    } catch (err) {
      console.error('[ProfilePage] avatar upload failed:', err instanceof Error ? err.message : err);
      setAvatarError(err instanceof Error ? err.message : 'Could not update avatar');
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  }

  async function handleAvatarRemove() {
    setAvatarError(null);
    const previous = profile.avatar;
    setProfileAvatar(null);
    try {
      await api.deleteAvatar();
      console.log('[ProfilePage] avatar removed');
    } catch (err) {
      console.error('[ProfilePage] avatar removal failed:', err instanceof Error ? err.message : err);
      setProfileAvatar(previous);
      setAvatarError(err instanceof Error ? err.message : 'Could not remove avatar');
    }
  }

  const likedVideos = useMemo(() => videos.filter((v) => v.liked), [videos]);
  const favoriteVideos = useMemo(() => videos.filter((v) => v.favorited), [videos]);
  const downloadedVideos = useMemo(() => videos.filter((v) => v.saved), [videos]);
  const commentedVideos = useMemo(() => {
    const ids = new Set(getCommentedVideoIds());
    return videos.filter((v) => ids.has(v.id));
  }, [videos]);

  const stats = useMemo(
    () => [
      { id: 'liked' as const, label: 'Liked', value: likedVideos.length },
      { id: 'favorites' as const, label: 'Favorites', value: favoriteVideos.length },
      { id: 'downloads' as const, label: 'Downloads', value: downloadedVideos.length },
      { id: 'comments' as const, label: 'Comments', value: commentedVideos.length },
    ],
    [likedVideos, favoriteVideos, downloadedVideos, commentedVideos]
  );

  async function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) {
      setSearchResults(null);
      return;
    }
    console.log(`[ProfilePage] searching videos for "${trimmed}"`);
    setSearchLoading(true);
    setSearchError(null);
    try {
      const res = await api.searchVideos(trimmed);
      console.log(`[ProfilePage] search "${trimmed}" -> ${res.videos.length} result(s)`);
      setSearchResults(res.videos);
      addRecentSearch(trimmed);
      setRecentSearches(getRecentSearches());
    } catch (err) {
      console.error(`[ProfilePage] search "${trimmed}" failed:`, err instanceof Error ? err.message : err);
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearchLoading(false);
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    runSearch(searchQuery);
  }

  return (
    <div className="h-dvh w-full bg-black flex flex-col overflow-hidden">
      {/* Header: soft brand-tinted gradient wash behind the avatar/name row,
          instead of a flat black bar, so the profile reads as its own
          distinct space rather than an extension of the feed chrome. */}
      <div className="safe-top shrink-0 relative overflow-hidden border-b border-white/10">
        <div
          className="absolute inset-0 opacity-70"
          style={{
            background: 'radial-gradient(120% 140% at 15% 0%, rgba(37,244,238,0.16), transparent 55%), radial-gradient(120% 140% at 85% 0%, rgba(254,44,85,0.14), transparent 55%)',
          }}
          aria-hidden="true"
        />
        <div className="relative flex items-center gap-3 px-3 py-3.5">
          <Link to="/" aria-label="Back to feed" className="tap-target -ml-2 text-white flex items-center justify-center">
            <ArrowLeft size={22} />
          </Link>

          <button
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            disabled={avatarUploading}
            aria-label={profile.avatar ? 'Change profile photo' : 'Add profile photo'}
            className="relative w-14 h-14 rounded-full overflow-hidden bg-white/10 flex items-center justify-center shrink-0 disabled:opacity-60 ring-2 ring-white/15 shadow-lg shadow-black/40"
          >
            {avatarUploading ? (
              <Loader2 size={18} className="text-white/70 animate-spin" />
            ) : (
              <Avatar src={profile.avatar} size={56} alt="" />
            )}
            {!avatarUploading && (
              <span className="absolute bottom-0 inset-x-0 bg-black/60 flex items-center justify-center py-1">
                <Camera size={11} className="text-white/85" />
              </span>
            )}
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleAvatarChange(e.target.files?.[0] || null)}
          />

          <div className="flex-1 min-w-0">
            <h1 className="text-white font-semibold text-base truncate">{profile.displayName || 'Profile'}</h1>
            {profile.avatar && !avatarUploading ? (
              <button type="button" onClick={handleAvatarRemove} className="text-white/40 text-xs underline decoration-white/20">
                Remove photo
              </button>
            ) : (
              <span className="text-white/40 text-xs">Tap your photo to add one</span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowSettings(true)}
            aria-label="Profile settings"
            className="tap-target shrink-0 -mr-2 text-white/70 hover:text-white transition-colors"
          >
            <SettingsIcon size={22} />
          </button>
        </div>

        {avatarError && (
          <p className="relative safe-left safe-right text-red-400 text-xs text-center pb-2">{avatarError}</p>
        )}

        {/* Stat row — real counts derived from the viewer's own video
            state (liked/favorited/saved/commented), not placeholder
            numbers, so it stays accurate as those change elsewhere in
            the app without a separate fetch. */}
        {!loading && !error && (
          <div className="relative grid grid-cols-4 gap-1 px-3 pb-3">
            {stats.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setTab(s.id)}
                className={`flex flex-col items-center rounded-lg py-1.5 transition-colors ${
                  tab === s.id ? 'bg-white/10' : 'hover:bg-white/5'
                }`}
              >
                <span className="text-white text-sm font-semibold tabular-nums">{formatCount(s.value)}</span>
                <span className="text-white/45 text-[10px]">{s.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="safe-left safe-right flex items-center gap-1 px-2 py-2 border-b border-white/10 overflow-x-auto no-scrollbar shrink-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={`shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
              tab === id ? 'bg-brand-pink text-white shadow-sm shadow-brand-pink/30' : 'text-white/60 hover:text-white/90 hover:bg-white/5'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 px-3 sm:px-4 pt-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <ThumbSkeleton key={i} />
            ))}
          </div>
        )}
        {!loading && error && (
          <div className="flex flex-col items-center gap-3 mt-14 px-6 text-center">
            <ImageOff size={26} className="text-white/20" />
            <p className="text-white/60 text-sm">{error}</p>
            <button
              type="button"
              onClick={loadVideos}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-white/10 hover:bg-white/15 rounded-full px-3.5 py-1.5 transition-colors"
            >
              <RefreshCw size={13} /> Try again
            </button>
          </div>
        )}

        {!loading && !error && (
          <div className="pt-3">
            {tab === 'liked' && (
              <VideoGrid
                videos={likedVideos}
                onOpen={setPreviewVideo}
                emptyLabel="Videos you like will show up here."
                emptyIcon={Heart}
              />
            )}
            {tab === 'favorites' && (
              <VideoGrid
                videos={favoriteVideos}
                onOpen={setPreviewVideo}
                emptyLabel="Videos you save as a favorite will show up here."
                emptyIcon={Bookmark}
              />
            )}
            {tab === 'downloads' && (
              <VideoGrid
                videos={downloadedVideos}
                onOpen={setPreviewVideo}
                emptyLabel="Videos you download will show up here."
                emptyIcon={Download}
              />
            )}
            {tab === 'comments' && (
              <VideoGrid
                videos={commentedVideos}
                onOpen={setPreviewVideo}
                emptyLabel="Videos you've commented on will show up here."
                emptyIcon={MessageCircle}
              />
            )}
            {tab === 'search' && (
              <div>
                <form onSubmit={handleSearchSubmit} className="px-3 sm:px-4 pb-3">
                  <div className="relative">
                    <SearchIcon size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/50" />
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search all videos…"
                      inputMode="search"
                      autoComplete="off"
                      aria-label="Search all videos"
                      className="w-full bg-white/10 text-white text-sm rounded-full pl-9 pr-9 py-2.5 outline-none placeholder:text-white/50 focus:ring-2 focus:ring-brand-cyan/50 transition-shadow"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          setSearchResults(null);
                        }}
                        aria-label="Clear search"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-white/60 hover:text-white"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                </form>

                {!searchResults && recentSearches.length > 0 && (
                  <div className="px-3 sm:px-4 pb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="flex items-center gap-1.5 text-white/50 text-xs font-medium">
                        <History size={13} /> Recent searches
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          clearRecentSearches();
                          setRecentSearches([]);
                        }}
                        className="text-white/40 text-xs underline"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {recentSearches.map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => {
                            setSearchQuery(q);
                            runSearch(q);
                          }}
                          className="bg-white/10 hover:bg-white/15 text-white/80 text-xs rounded-full px-3 py-1.5 transition-colors"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {searchLoading && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 px-3 sm:px-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <ThumbSkeleton key={i} />
                    ))}
                  </div>
                )}
                {searchError && <p className="text-red-400 text-sm text-center mt-6">{searchError}</p>}
                {searchResults && !searchLoading && !searchError && (
                  <VideoGrid
                    videos={searchResults}
                    onOpen={setPreviewVideo}
                    emptyLabel="No videos matched that search."
                    emptyIcon={SearchIcon}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showSettings && <ProfileSettings displayName={profile.displayName} onClose={() => setShowSettings(false)} />}

      {previewVideo && (
        <div className="fixed inset-0 z-50 bg-black sm:bg-black/90 flex items-center justify-center">
          <div className="relative h-full w-full sm:h-[94dvh] sm:max-h-[900px] sm:w-[420px] sm:rounded-2xl sm:overflow-hidden bg-black">
            <VideoCard video={previewVideo} active />
            <button
              type="button"
              onClick={() => setPreviewVideo(null)}
              aria-label="Close preview"
              className="tap-target safe-top absolute top-4 left-3 z-10 text-white bg-black/40 rounded-full flex items-center justify-center"
            >
              <ArrowLeft size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
