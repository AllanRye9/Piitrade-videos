import { useEffect, useState } from 'react';
import { api } from './api';
import type { Video } from './types';
import VideoFeed from './components/VideoFeed';
import TopBar from './components/TopBar';
import UploadModal from './components/UploadModal';
import { registerFirstInteractionAutoUnmute } from './soundPreference';

export default function App() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searching, setSearching] = useState(false);

  // Registered once, here, rather than per-VideoCard — it only needs
  // one document-level listener for the whole app, and mounting
  // several VideoCards (VideoFeed keeps more than the active one
  // mounted) would otherwise register (and no-op) it redundantly.
  useEffect(() => {
    registerFirstInteractionAutoUnmute();
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

  // Fetches the next page and appends it — called by VideoFeed once the
  // viewer scrolls near the end of what's currently loaded. Skipped
  // entirely while a search is active (search results aren't paginated)
  // or there's nothing further to fetch.
  function loadMore() {
    if (searching || loadingMore || !nextCursor) return;
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
      loadAll();
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
    // On phones this fills the whole viewport, same as before. From
    // `sm` up (tablets, laptops, desktops) the feed is boxed into a
    // fixed-width, phone-proportioned column centered on the screen —
    // the same layout TikTok/Reels/Shorts use on the web — instead of
    // one video stretching edge-to-edge across a wide monitor.
    <div className="h-dvh w-full bg-black sm:bg-neutral-950 flex items-center justify-center overflow-hidden">
      <div className="relative h-full w-full sm:h-[94dvh] sm:max-h-[900px] sm:w-[420px] sm:rounded-2xl sm:overflow-hidden sm:shadow-2xl sm:shadow-black/60 bg-black">
        <TopBar onSearch={handleSearch} onUploadClick={() => setShowUpload(true)} />

        {loading && (
          <div className="h-full w-full flex items-center justify-center text-white/60 text-sm">Loading videos…</div>
        )}
        {!loading && error && (
          <div className="h-full w-full flex flex-col items-center justify-center text-white/60 text-sm gap-3 px-6 text-center">
            <p>{error}</p>
            <button type="button" onClick={loadAll} className="text-brand-cyan underline">
              Retry
            </button>
          </div>
        )}
        {!loading && !error && videos.length === 0 && (
          <div className="h-full w-full flex flex-col items-center justify-center text-white/60 text-sm gap-3 px-6 text-center">
            <p>No videos yet.</p>
            <button type="button" onClick={() => setShowUpload(true)} className="text-brand-cyan underline">
              Upload the first one
            </button>
          </div>
        )}
        {!loading && !error && videos.length > 0 && <VideoFeed videos={videos} onNearEnd={loadMore} />}

        {showUpload && <UploadModal onClose={() => setShowUpload(false)} onUploaded={handleUploaded} />}
      </div>
    </div>
  );
}
