import { useEffect, useRef, useState } from 'react';
import type { Video } from '../types';
import { api } from '../api';
import CropOverlay from './CropOverlay';
import SearchResultsPanel from './SearchResultsPanel';
import CommentModal from './CommentModal';
import type { VisualSearchResult } from '../types';

interface Props {
  video: Video;
  active: boolean;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function VideoCard({ video, active }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [liked, setLiked] = useState(video.liked);
  const [favorited, setFavorited] = useState(video.favorited);
  const [likes, setLikes] = useState(video.likes);
  const [commentCount, setCommentCount] = useState(video.comments);
  const [showCrop, setShowCrop] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<VisualSearchResult[] | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (active) {
      el.play().catch(() => setPlaying(false));
      setPlaying(true);
    } else {
      el.pause();
      el.currentTime = 0;
    }
  }, [active]);

  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  }

  function toggleMute(e: React.MouseEvent) {
    e.stopPropagation();
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  }

  async function handleLike(e: React.MouseEvent) {
    e.stopPropagation();
    setLiked((l) => !l);
    setLikes((n) => (liked ? n - 1 : n + 1));
    try {
      const res = await api.like(video.id);
      setLiked(res.liked);
      setLikes(res.likes);
    } catch {
      setLiked((l) => !l);
      setLikes((n) => (liked ? n + 1 : n - 1));
    }
  }

  async function handleFavorite(e: React.MouseEvent) {
    e.stopPropagation();
    setFavorited((f) => !f);
    try {
      const res = await api.favorite(video.id);
      setFavorited(res.favorited);
    } catch {
      setFavorited((f) => !f);
    }
  }

  function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = video.url;
    a.download = `${video.title || 'video'}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function openCrop(e: React.MouseEvent) {
    e.stopPropagation();
    if (!videoRef.current) return;
    setShowCrop(true);
  }

  async function handleCropped(blob: Blob) {
    setShowCrop(false);
    setShowResults(true);
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults(null);
    try {
      const res = await api.visualSearch(blob);
      setSearchResults(res.results);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearchLoading(false);
    }
  }

  return (
    <div className="relative h-full w-full snap-start flex items-center justify-center bg-black">
      <video
        ref={videoRef}
        src={video.url}
        poster={video.poster || undefined}
        loop
        muted={muted}
        playsInline
        crossOrigin="anonymous"
        onClick={togglePlay}
        className="h-full w-full object-contain"
      />

      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-full bg-black/40 flex items-center justify-center text-white text-3xl">▶</div>
        </div>
      )}

      <button
        onClick={toggleMute}
        className="tap-target safe-right absolute top-4 right-4 text-white text-xl bg-black/30 rounded-full flex items-center justify-center"
      >
        {muted ? '🔇' : '🔊'}
      </button>

      <div className="safe-left safe-bottom absolute left-3 right-16 sm:right-20 bottom-4 text-white">
        <p className="font-semibold text-sm drop-shadow break-words">{video.title}</p>
        {video.description && <p className="text-xs text-white/80 mt-1 line-clamp-2 drop-shadow">{video.description}</p>}
      </div>

      <div className="safe-right safe-bottom absolute right-2 sm:right-3 bottom-4 flex flex-col items-center gap-3 sm:gap-5">
        <button onClick={handleLike} className="tap-target flex flex-col items-center justify-center text-white">
          <span className={`text-2xl ${liked ? 'scale-110' : ''} transition-transform`}>{liked ? '❤️' : '🤍'}</span>
          <span className="text-xs mt-1">{formatCount(likes)}</span>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowComments(true);
          }}
          className="tap-target flex flex-col items-center justify-center text-white"
        >
          <span className="text-2xl">💬</span>
          <span className="text-xs mt-1">{formatCount(commentCount)}</span>
        </button>
        <button onClick={handleFavorite} className="tap-target flex flex-col items-center justify-center text-white">
          <span className="text-2xl">{favorited ? '⭐' : '☆'}</span>
          <span className="text-xs mt-1">Save</span>
        </button>
        <button onClick={openCrop} className="tap-target flex flex-col items-center justify-center text-white">
          <span className="text-2xl">🔍</span>
          <span className="text-xs mt-1">Search</span>
        </button>
        <button onClick={handleDownload} className="tap-target flex flex-col items-center justify-center text-white">
          <span className="text-2xl">⬇️</span>
          <span className="text-xs mt-1">Save</span>
        </button>
      </div>

      {showCrop && videoRef.current && (
        <CropOverlay videoEl={videoRef.current} onCancel={() => setShowCrop(false)} onCropped={handleCropped} />
      )}
      {showResults && (
        <SearchResultsPanel
          loading={searchLoading}
          error={searchError}
          results={searchResults}
          onClose={() => setShowResults(false)}
        />
      )}
      {showComments && (
        <CommentModal videoId={video.id} onClose={() => setShowComments(false)} onCommentPosted={setCommentCount} />
      )}
    </div>
  );
}
