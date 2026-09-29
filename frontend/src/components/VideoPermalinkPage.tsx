import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Video } from '../types';
import { api } from '../api';
import VideoCard from './VideoCard';
import { ArrowLeft } from 'lucide-react';

// The permalink a shared link actually points to (see VideoCard's
// handleShare). Deliberately reuses VideoCard as-is rather than a
// stripped-down player — a shared video should be exactly as
// interactive (like, comment, shop, re-share) as it is in the feed,
// not a lesser preview of it.
export default function VideoPermalinkPage() {
  const { id } = useParams<{ id: string }>();
  const [video, setVideo] = useState<Video | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    api
      .getVideo(id)
      .then((res) => setVideo(res.video))
      .catch((err) => setError(err instanceof Error ? err.message : 'This video could not be found'))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="h-dvh w-full bg-black flex items-center justify-center">
      {loading && <p className="text-white/50 text-sm">Loading…</p>}
      {!loading && error && (
        <div className="text-center px-6">
          <p className="text-white/60 text-sm mb-4">{error}</p>
          <Link to="/" className="text-brand-cyan text-sm font-semibold">
            Go to the feed
          </Link>
        </div>
      )}
      {!loading && !error && video && (
        <div className="relative h-full w-full sm:h-[94dvh] sm:max-h-[900px] sm:w-[420px] sm:rounded-2xl sm:overflow-hidden bg-black">
          <VideoCard video={video} active />
          <Link
            to="/"
            aria-label="Back to feed"
            className="tap-target safe-top absolute top-4 left-3 z-10 text-white bg-black/40 rounded-full flex items-center justify-center"
          >
            <ArrowLeft size={20} />
          </Link>
        </div>
      )}
    </div>
  );
}
