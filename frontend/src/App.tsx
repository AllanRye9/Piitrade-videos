import { useEffect, useState } from 'react';
import { api } from './api';
import type { Video } from './types';
import VideoFeed from './components/VideoFeed';
import TopBar from './components/TopBar';
import UploadModal from './components/UploadModal';

export default function App() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  function loadAll() {
    setLoading(true);
    setError(null);
    api
      .listVideos()
      .then((res) => setVideos(res.videos))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load videos'))
      .finally(() => setLoading(false));
  }

  useEffect(loadAll, []);

  function handleSearch(query: string) {
    if (!query) {
      loadAll();
      return;
    }
    setLoading(true);
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
    <div className="h-dvh w-full bg-black relative overflow-hidden">
      <TopBar onSearch={handleSearch} onUploadClick={() => setShowUpload(true)} />

      {loading && (
        <div className="h-full w-full flex items-center justify-center text-white/60 text-sm">Loading videos…</div>
      )}
      {!loading && error && (
        <div className="h-full w-full flex flex-col items-center justify-center text-white/60 text-sm gap-3 px-6 text-center">
          <p>{error}</p>
          <button onClick={loadAll} className="text-brand-cyan underline">
            Retry
          </button>
        </div>
      )}
      {!loading && !error && videos.length === 0 && (
        <div className="h-full w-full flex flex-col items-center justify-center text-white/60 text-sm gap-3 px-6 text-center">
          <p>No videos yet.</p>
          <button onClick={() => setShowUpload(true)} className="text-brand-cyan underline">
            Upload the first one
          </button>
        </div>
      )}
      {!loading && !error && videos.length > 0 && <VideoFeed videos={videos} />}

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onUploaded={handleUploaded} />}
    </div>
  );
}
