import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Video } from '../types';
import { api } from '../api';
import { mediaUrl } from '../config';
import VideoCard from './VideoCard';
import { ArrowLeft, Heart, MessageCircle, Play, Hash, Loader2 } from 'lucide-react';

// Same thumbnail/preview-modal pattern as AccountPage's video grid —
// duplicated locally rather than shared, matching how AccountPage
// already does it, since there's no existing shared component for it.
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
            <Heart size={10} /> {video.likes}
          </span>
          <span className="flex items-center gap-0.5">
            <MessageCircle size={10} /> {video.comments}
          </span>
        </div>
      </div>
    </button>
  );
}

export default function HashtagPage() {
  const { tag } = useParams<{ tag: string }>();
  const [videos, setVideos] = useState<Video[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewVideo, setPreviewVideo] = useState<Video | null>(null);

  useEffect(() => {
    if (!tag) return;
    setLoading(true);
    setError(null);
    api
      .getHashtagVideos(tag)
      .then((res) => {
        setVideos(res.videos);
        setNextCursor(res.nextCursor);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load these videos'))
      .finally(() => setLoading(false));
  }, [tag]);

  function loadMore() {
    if (!tag || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    api
      .getHashtagVideos(tag, nextCursor)
      .then((res) => {
        setVideos((prev) => [...prev, ...res.videos]);
        setNextCursor(res.nextCursor);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }

  return (
    <div className="h-dvh w-full bg-black flex flex-col overflow-hidden">
      <div className="safe-top safe-left safe-right flex items-center gap-3 px-3 py-3 border-b border-white/10 shrink-0">
        <Link to="/discover" aria-label="Back to discover" className="tap-target -ml-2 text-white flex items-center justify-center">
          <ArrowLeft size={22} />
        </Link>
        <h1 className="text-white font-semibold text-base truncate flex items-center gap-1">
          <Hash size={16} className="text-brand-cyan" />
          {tag}
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="text-white/50 text-sm text-center mt-10">Loading…</p>}
        {!loading && error && <p className="text-white/60 text-sm text-center mt-10 px-6">{error}</p>}
        {!loading && !error && videos.length === 0 && (
          <p className="text-white/50 text-sm text-center mt-10 px-6">No videos with #{tag} yet.</p>
        )}
        {!loading && !error && videos.length > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 px-3 sm:px-4 pt-3 pb-3">
              {videos.map((v) => (
                <VideoThumb key={v.id} video={v} onOpen={setPreviewVideo} />
              ))}
            </div>
            {nextCursor && (
              <div className="flex justify-center pb-6">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="flex items-center gap-1.5 text-white/60 text-sm px-4 py-2"
                >
                  {loadingMore && <Loader2 size={14} className="animate-spin" />}
                  Load more
                </button>
              </div>
            )}
          </>
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
