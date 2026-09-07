import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Video } from '../types';
import { api } from '../api';
import { mediaUrl } from '../config';
import VideoCard from './VideoCard';
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
} from 'lucide-react';

type TabId = 'liked' | 'favorites' | 'downloads' | 'comments' | 'search';

const TABS: { id: TabId; label: string; icon: typeof Heart }[] = [
  { id: 'liked', label: 'Liked', icon: Heart },
  { id: 'favorites', label: 'Favorites', icon: Bookmark },
  { id: 'downloads', label: 'Downloads', icon: Download },
  { id: 'comments', label: 'Comments', icon: MessageCircle },
  { id: 'search', label: 'Search', icon: SearchIcon },
];

function VideoThumb({ video, onOpen }: { video: Video; onOpen: (v: Video) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(video)}
      className="group relative aspect-[9/16] w-full overflow-hidden rounded-lg bg-neutral-900 text-left"
    >
      {video.poster ? (
        <img
          src={mediaUrl(video.poster)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
        />
      ) : (
        <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900">
          <Play className="text-white/30" size={28} />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
        <p className="text-white text-xs font-medium line-clamp-2">{video.title || 'Untitled'}</p>
        <div className="flex items-center gap-2 mt-1 text-white/70 text-[10px]">
          <span className="flex items-center gap-0.5">
            <Heart size={10} fill={video.liked ? 'currentColor' : 'none'} /> {video.likes}
          </span>
          <span className="flex items-center gap-0.5">
            <MessageCircle size={10} /> {video.comments}
          </span>
        </div>
      </div>
    </button>
  );
}

function EmptyState({ label }: { label: string }) {
  return <p className="text-white/50 text-sm text-center mt-10 px-6">{label}</p>;
}

function VideoGrid({ videos, onOpen, emptyLabel }: { videos: Video[]; onOpen: (v: Video) => void; emptyLabel: string }) {
  if (videos.length === 0) return <EmptyState label={emptyLabel} />;
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

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Video[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>(getRecentSearches());

  useEffect(() => {
    api
      .listVideos()
      .then((res) => setVideos(res.videos))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load your videos'))
      .finally(() => setLoading(false));
  }, []);

  const likedVideos = useMemo(() => videos.filter((v) => v.liked), [videos]);
  const favoriteVideos = useMemo(() => videos.filter((v) => v.favorited), [videos]);
  const downloadedVideos = useMemo(() => videos.filter((v) => v.saved), [videos]);
  const commentedVideos = useMemo(() => {
    const ids = new Set(getCommentedVideoIds());
    return videos.filter((v) => ids.has(v.id));
  }, [videos]);

  async function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) {
      setSearchResults(null);
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    try {
      const res = await api.searchVideos(trimmed);
      setSearchResults(res.videos);
      addRecentSearch(trimmed);
      setRecentSearches(getRecentSearches());
    } catch (err) {
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
      <div className="safe-top safe-left safe-right flex items-center gap-3 px-3 py-3 border-b border-white/10 shrink-0">
        <Link to="/" aria-label="Back to feed" className="tap-target -ml-2 text-white flex items-center justify-center">
          <ArrowLeft size={22} />
        </Link>
        <h1 className="text-white font-semibold text-base">Profile</h1>
      </div>

      <div className="safe-left safe-right flex items-center gap-1 px-2 py-2 border-b border-white/10 overflow-x-auto no-scrollbar shrink-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={`shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
              tab === id ? 'bg-brand-pink text-white' : 'text-white/60 hover:text-white/90'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="text-white/50 text-sm text-center mt-10">Loading…</p>}
        {!loading && error && (
          <div className="flex flex-col items-center gap-2 mt-10 px-6 text-center">
            <p className="text-white/60 text-sm">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <div className="pt-3">
            {tab === 'liked' && (
              <VideoGrid videos={likedVideos} onOpen={setPreviewVideo} emptyLabel="Videos you like will show up here." />
            )}
            {tab === 'favorites' && (
              <VideoGrid
                videos={favoriteVideos}
                onOpen={setPreviewVideo}
                emptyLabel="Videos you save as a favorite will show up here."
              />
            )}
            {tab === 'downloads' && (
              <VideoGrid
                videos={downloadedVideos}
                onOpen={setPreviewVideo}
                emptyLabel="Videos you download will show up here."
              />
            )}
            {tab === 'comments' && (
              <VideoGrid
                videos={commentedVideos}
                onOpen={setPreviewVideo}
                emptyLabel="Videos you've commented on will show up here."
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
                      className="w-full bg-white/10 text-white text-sm rounded-full pl-9 pr-9 py-2.5 outline-none placeholder:text-white/50"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          setSearchResults(null);
                        }}
                        aria-label="Clear search"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-white/60"
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
                          className="bg-white/10 text-white/80 text-xs rounded-full px-3 py-1.5"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {searchLoading && <p className="text-white/50 text-sm text-center mt-6">Searching…</p>}
                {searchError && <p className="text-red-400 text-sm text-center mt-6">{searchError}</p>}
                {searchResults && !searchLoading && !searchError && (
                  <VideoGrid videos={searchResults} onOpen={setPreviewVideo} emptyLabel="No videos matched that search." />
                )}
              </div>
            )}
          </div>
        )}
      </div>

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
