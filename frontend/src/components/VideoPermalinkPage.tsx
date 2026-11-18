import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Video } from '../types';
import { api, getAccountEmail } from '../api';
import { useSeo } from '../seo';
import { mediaUrl } from '../config';
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
  const signedIn = !!getAccountEmail();

  // Same tags the server puts in the HTML for crawlers (backend/src/routes/seo.ts), kept in sync here for Googlebot and in-app navigation.
  const canonical = id ? `/v/${id}` : undefined;
  const abs = (u: string) => new URL(mediaUrl(u) || u, window.location.origin).toString();
  useSeo(
    video
      ? {
          title: video.title || 'Video',
          description: video.description || `Watch "${video.title}" on Yotweek.`,
          canonical,
          image: video.poster ? abs(video.poster) : null,
          ogType: 'video.other',
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'VideoObject',
            name: video.title || 'Untitled video',
            description: video.description || video.title,
            thumbnailUrl: video.poster ? [abs(video.poster)] : undefined,
            uploadDate: video.createdAt,
            contentUrl: abs(video.url),
            ...(video.duration ? { duration: `PT${Math.floor(video.duration / 60)}M${Math.round(video.duration % 60)}S` } : {}),
          },
        }
      : { title: error ? 'Video not found' : 'Video', noindex: true }
  );

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
          <Link to="/" className="text-brand-amber text-sm font-semibold">
            Go to the feed
          </Link>
        </div>
      )}
      {!loading && !error && video && (
        <div className="relative h-full w-full sm:h-[94dvh] sm:max-h-[900px] sm:w-[420px] sm:rounded-2xl sm:overflow-hidden bg-black">
          <VideoCard video={video} active />
          {!signedIn && (
            <Link
              to="/"
              className="safe-top absolute top-4 right-3 z-10 rounded-full bg-black/55 px-4 py-2 text-sm font-semibold text-white"
            >
              Sign in to like &amp; comment
            </Link>
          )}
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
