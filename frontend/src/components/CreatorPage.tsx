import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { mediaUrl } from '../config';
import type { Creator, CreatorVideoSummary, Video } from '../types';
import Avatar from './Avatar';
import VideoCard from './VideoCard';
import { ArrowLeft, Play, Heart, Eye } from 'lucide-react';

export default function CreatorPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [videos, setVideos] = useState<CreatorVideoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewVideo, setPreviewVideo] = useState<Video | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    api
      .getCreator(sessionId)
      .then((res) => {
        setCreator(res.creator);
        setVideos(res.videos);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load this creator'))
      .finally(() => setLoading(false));
  }, [sessionId]);

  async function openVideo(id: string) {
    setOpeningId(id);
    try {
      const res = await api.getVideo(id);
      setPreviewVideo(res.video);
    } catch {
      // Non-fatal — the thumbnail just doesn't open; the rest of the page still works.
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <div className="h-dvh w-full bg-black sm:bg-neutral-950 flex items-center justify-center overflow-hidden">
      <div className="relative h-full w-full sm:h-[94dvh] sm:max-h-[900px] sm:w-[420px] sm:rounded-2xl sm:overflow-hidden sm:shadow-2xl sm:shadow-black/60 bg-black flex flex-col">
        <div className="safe-top flex items-center gap-3 px-3 py-3 border-b border-white/10 shrink-0">
          <Link to="/" aria-label="Back to feed" className="tap-target -ml-2 text-white flex items-center justify-center">
            <ArrowLeft size={22} />
          </Link>
          <h1 className="text-white font-semibold text-base">Creator</h1>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <p className="text-white/60 text-sm text-center py-16">Loading…</p>}
          {!loading && error && <p className="text-white/60 text-sm text-center py-16 px-6">{error}</p>}

          {!loading && !error && creator && (
            <>
              <div className="flex flex-col items-center gap-2 px-4 pt-6 pb-4">
                <Avatar src={creator.avatar} size={72} alt={creator.displayName || 'Creator'} />
                <h2 className="text-white font-semibold text-lg">{creator.displayName || 'Unnamed creator'}</h2>
                <div className="flex items-center gap-4 text-white/60 text-xs mt-1">
                  <span>
                    <strong className="text-white">{creator.videoCount}</strong> video{creator.videoCount === 1 ? '' : 's'}
                  </span>
                  <span className="flex items-center gap-1">
                    <Heart size={12} /> {creator.totalLikes}
                  </span>
                  <span className="flex items-center gap-1">
                    <Eye size={12} /> {creator.totalViews}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-0.5 px-0.5 pb-4">
                {videos.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => openVideo(v.id)}
                    disabled={openingId === v.id}
                    className="relative aspect-[9/16] bg-neutral-900 overflow-hidden"
                  >
                    {v.poster ? (
                      <img src={mediaUrl(v.poster)} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <Play className="text-white/30" size={20} />
                      </div>
                    )}
                    <span className="absolute bottom-1 left-1 flex items-center gap-0.5 text-white text-[10px] bg-black/50 rounded px-1">
                      <Heart size={9} /> {v.likes}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
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
