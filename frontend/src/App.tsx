import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './api';
import type { Video } from './types';
import VideoFeed from './components/VideoFeed';
import TopBar, { FeedMode } from './components/TopBar';
import UploadModal from './components/UploadModal';
import ProfileSettings from './components/ProfileSettings';
import NotificationsPanel from './components/NotificationsPanel';
import { registerFirstInteractionAutoUnmute } from './soundPreference';
import { ensureProfileLoaded, getProfileState, subscribeProfile } from './profileStore';

// How often to refresh the unread-notifications badge in the
// background. There's no WebSocket/push infra in this app (a real
// "live" badge would need one), so this is a deliberately cheap
// approximation — good enough for "did something happen recently"
// without building real-time infrastructure for it.
const NOTIFICATION_POLL_MS = 30_000;

export default function App() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searching, setSearching] = useState(false);
  // 'trending' is a capped, non-paginated top-50 list (see GET
  // /api/videos/trending) — a safe addition alongside the existing
  // cursor-paginated 'latest' feed rather than a replacement for it.
  const [mode, setMode] = useState<FeedMode>('latest');
  const profile = useSyncExternalStore(subscribeProfile, getProfileState);

  // Registered once, here, rather than per-VideoCard — it only needs
  // one document-level listener for the whole app, and mounting
  // several VideoCards (VideoFeed keeps more than the active one
  // mounted) would otherwise register (and no-op) it redundantly.
  useEffect(() => {
    registerFirstInteractionAutoUnmute();
    ensureProfileLoaded();

    function refreshUnreadCount() {
      api
        .getNotifications()
        .then((res) => setUnreadCount(res.unreadCount))
        .catch(() => {}); // a failed background poll just tries again next interval
    }
    refreshUnreadCount();
    const interval = setInterval(refreshUnreadCount, NOTIFICATION_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  function loadAll() {
    setLoading(true);
    setError(null);
    setSearching(false);
    api
      .listVideos()
      .then((res) => {
        setVideos(res.videos);
        setNextCursor(res.nextCursor);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load videos'))
      .finally(() => setLoading(false));
  }

  function loadTrending() {
    setLoading(true);
    setError(null);
    setSearching(false);
    setNextCursor(null); // trending has no further pages to load
    api
      .getTrendingVideos()
      .then((res) => setVideos(res.videos))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load trending videos'))
      .finally(() => setLoading(false));
  }

  function switchMode(next: FeedMode) {
    setMode(next);
    if (next === 'trending') loadTrending();
    else loadAll();
  }

  // Fetches the next page and appends it — called by VideoFeed once the
  // viewer scrolls near the end of what's currently loaded. Skipped
  // entirely while a search is active (search results aren't paginated)
  // or there's nothing further to fetch — which includes 'trending'
  // mode, a fixed top-50 list with no cursor at all.
  function loadMore() {
    if (mode !== 'latest' || searching || loadingMore || !nextCursor) return;
    setLoadingMore(true);
    api
      .listVideos(nextCursor)
      .then((res) => {
        setVideos((prev) => [...prev, ...res.videos]);
        setNextCursor(res.nextCursor);
      })
      .catch(() => {}) // a failed "load more" isn't worth interrupting an otherwise-working feed over
      .finally(() => setLoadingMore(false));
  }

  useEffect(loadAll, []);

  function handleSearch(query: string) {
    if (!query) {
      switchMode(mode);
      return;
    }
    setLoading(true);
    setSearching(true);
    setNextCursor(null);
    api
      .searchVideos(query)
      .then((res) => setVideos(res.videos))
      .catch((err) => setError(err instanceof Error ? err.message : 'Search failed'))
      .finally(() => setLoading(false));
  }

  function handleUploaded(video: Video) {
    setShowUpload(false);
    setVideos((prev) => [video, ...prev]);
  }

  return (
    // Layout: a slim solid header (TopBar) above a stage that holds
    // the video — so the header's controls, including the
    // Latest/Trending switcher, sit BESIDE the video, never on it.
    // On phones the stage fills everything under the header. From `sm`
    // up (tablets, laptops, desktops) the stage is a fixed-width,
    // phone-proportioned column centered under a full-width header —
    // the same layout TikTok/Reels/Shorts use on the web — instead of
    // one video stretching edge-to-edge across a wide monitor.
    <div className="h-dvh w-full bg-neutral-950 flex flex-col overflow-hidden">
      <TopBar
        mode={mode}
        onModeChange={switchMode}
        onSearch={handleSearch}
        onUploadClick={() => setShowUpload(true)}
        onSettingsClick={() => setShowSettings(true)}
        onNotificationsClick={() => setShowNotifications(true)}
        unreadCount={unreadCount}
      />

      <main className="relative flex-1 min-h-0 w-full flex justify-center sm:py-3">
        <div className="relative h-full w-full sm:max-w-[420px] bg-black sm:rounded-2xl sm:overflow-hidden sm:shadow-2xl sm:shadow-black/60 sm:ring-1 sm:ring-white/10">
          {loading && (
            <div className="h-full w-full flex items-center justify-center text-white/60 text-sm">Loading videos…</div>
          )}
          {!loading && error && (
            <div className="h-full w-full flex flex-col items-center justify-center text-white/60 text-sm gap-3 px-6 text-center">
              <p>{error}</p>
              <button type="button" onClick={loadAll} className="text-brand-amber underline">
                Retry
              </button>
            </div>
          )}
          {!loading && !error && videos.length === 0 && (
            <div className="h-full w-full flex flex-col items-center justify-center text-white/60 text-sm gap-3 px-6 text-center">
              <p>{searching ? 'No videos match your search.' : 'No videos yet.'}</p>
              {!searching && (
                <button type="button" onClick={() => setShowUpload(true)} className="text-brand-amber underline">
                  Upload the first one
                </button>
              )}
            </div>
          )}
          {!loading && !error && videos.length > 0 && <VideoFeed videos={videos} onNearEnd={loadMore} />}
        </div>
      </main>

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onUploaded={handleUploaded} />}
      {showSettings && (
        <ProfileSettings displayName={profile.displayName} handle={profile.handle} onClose={() => setShowSettings(false)} />
      )}
      {showNotifications && (
        <NotificationsPanel onClose={() => setShowNotifications(false)} onRead={() => setUnreadCount(0)} />
      )}
    </div>
  );
}
