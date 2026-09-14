import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import type { Video } from '../types';
import { api } from '../api';
import { mediaUrl } from '../config';
import CropOverlay from './CropOverlay';
import SearchResultsPanel from './SearchResultsPanel';
import CartBar from './CartBar';
import CheckoutModal from './CheckoutModal';
import CommentModal from './CommentModal';
import type { VisualSearchResult, CartItem } from '../types';
import { getMuted, setMuted as setSharedMuted, subscribeMuted } from '../soundPreference';
import { renderWatermarkedVideo, triggerBlobDownload } from '../videoWatermark';
import { Heart, MessageCircle, Bookmark, Search, Download, Volume2, VolumeX, Play } from 'lucide-react';

interface Props {
  video: Video;
  active: boolean;
}

// How long the video must be pressed and held before the long-press
// download control fires.
const LONG_PRESS_MS = 3000;

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function VideoCard({ video, active }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  // Shared across every VideoCard (see soundPreference.ts) so unmuting
  // one video keeps the rest of the feed unmuted too, instead of each
  // card reverting to muted on its own.
  const muted = useSyncExternalStore(subscribeMuted, getMuted);
  const [liked, setLiked] = useState(video.liked);
  const [favorited, setFavorited] = useState(video.favorited);
  const [saved, setSaved] = useState(video.saved);
  const [likes, setLikes] = useState(video.likes);
  const [commentCount, setCommentCount] = useState(video.comments);
  const [showCrop, setShowCrop] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<VisualSearchResult[] | null>(null);
  const [identification, setIdentification] = useState<string | null>(null);
  const [matchedQuery, setMatchedQuery] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);

  // Long-press-to-download control: holding the video for
  // LONG_PRESS_MS shows a filling ring, then triggers the same
  // watermarked download as the Download button.
  const [holdProgress, setHoldProgress] = useState(0); // 0–1 while holding
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0); // 0–1 while rendering the watermark
  const [downloadFlash, setDownloadFlash] = useState(false); // brief branded confirmation
  const holdRafRef = useRef<number>(0);
  const holdStartRef = useRef<number>(0);
  const longPressFiredRef = useRef(false);
  // Whether the video was actually playing right before the visual
  // search flow paused it — so "resume watching" only auto-plays if
  // the viewer hadn't already paused the video themselves.
  // Shown once, on the active card, until the viewer unmutes for the
  // first time ever — after that the preference is already known to
  // work (see soundPreference.ts) and the hint would just be noise.
  const [showSoundHint, setShowSoundHint] = useState(
    () => muted && (typeof localStorage === 'undefined' || localStorage.getItem('piitrade_sound_hint_seen') !== 'true')
  );

  useEffect(() => {
    if (!muted && showSoundHint) {
      setShowSoundHint(false);
      try {
        localStorage.setItem('piitrade_sound_hint_seen', 'true');
      } catch {
        // ignore
      }
    }
  }, [muted, showSoundHint]);

  const wasPlayingRef = useRef(false);

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
    setSharedMuted(!muted);
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

  // "Favorite" — saving a video to a personal favorites shelf. Kept
  // distinct from "Download" (below), which saves the file itself.
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

  // "Download" — renders a watermarked copy (piitrade.com branding
  // burned into the frames — see videoWatermark.ts) and saves it to
  // the device, AND records the server-side `saved` flag (the same
  // field the Profile page's Downloads tab reads back), so the two
  // stay in sync instead of the button doing a local browser download
  // that no other part of the app knows happened. Shared by both the
  // tap button below and the long-press control on the video itself.
  async function downloadWithWatermark() {
    if (downloading) return;
    setDownloading(true);
    setDownloadProgress(0);
    const src = mediaUrl(video.url) || video.url;
    try {
      const { blob, extension } = await renderWatermarkedVideo(src, (p) => setDownloadProgress(p.fraction));
      triggerBlobDownload(blob, `${video.title || 'video'}-piitrade.${extension}`);
      setDownloadFlash(true);
      setTimeout(() => setDownloadFlash(false), 1400);
    } catch {
      // Unsupported browser, tainted canvas, or recording failure —
      // fall back to a plain, unwatermarked download rather than
      // leaving the viewer with nothing.
      const a = document.createElement('a');
      a.href = src;
      a.download = `${video.title || 'video'}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setDownloading(false);
      setDownloadProgress(0);
    }

    if (!saved) {
      setSaved(true);
      try {
        const res = await api.save(video.id);
        setSaved(res.saved);
      } catch {
        setSaved(false);
      }
    }
  }

  function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    downloadWithWatermark();
  }

  // Long-press-to-download: pointerdown starts a rAF loop that tracks
  // how long the video has been held, driving the ring UI below; at
  // LONG_PRESS_MS it fires the same watermarked download as the
  // button. longPressFiredRef suppresses the togglePlay() the
  // trailing click would otherwise cause once the pointer lifts.
  function clearHold() {
    cancelAnimationFrame(holdRafRef.current);
    setHoldProgress(0);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLVideoElement>) {
    if (e.button !== undefined && e.button !== 0) return; // left click / primary touch only
    longPressFiredRef.current = false;
    holdStartRef.current = performance.now();
    const tick = () => {
      const elapsed = performance.now() - holdStartRef.current;
      const fraction = Math.min(1, elapsed / LONG_PRESS_MS);
      setHoldProgress(fraction);
      if (fraction >= 1) {
        longPressFiredRef.current = true;
        clearHold();
        downloadWithWatermark();
        return;
      }
      holdRafRef.current = requestAnimationFrame(tick);
    };
    holdRafRef.current = requestAnimationFrame(tick);
  }

  function handlePointerUp() {
    clearHold();
  }

  function handleVideoClick() {
    // A completed long-press already triggered the download — don't
    // also toggle play/pause on the same gesture's release.
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    togglePlay();
  }

  function openCrop(e: React.MouseEvent) {
    e.stopPropagation();
    const el = videoRef.current;
    if (!el) return;
    // Pause for the whole visual-search → cart → checkout flow. Only
    // resumed again by resumeWatching(), on cancel or completion —
    // never permanently, per the in-video shopping flow's design.
    wasPlayingRef.current = !el.paused;
    el.pause();
    setPlaying(false);
    setShowCrop(true);
  }

  function resumeWatching() {
    const el = videoRef.current;
    setShowCrop(false);
    setShowResults(false);
    setShowCheckout(false);
    if (el && wasPlayingRef.current) {
      el.play().catch(() => setPlaying(false));
      setPlaying(true);
    }
  }

  async function handleCropped(blob: Blob) {
    setShowCrop(false);
    setShowResults(true);
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults(null);
    setIdentification(null);
    setMatchedQuery(null);
    try {
      const res = await api.visualSearch(blob);
      setSearchResults(res.results);
      setIdentification(res.identification ?? null);
      setMatchedQuery(res.matchedQuery ?? null);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearchLoading(false);
    }
  }

  // Manual, user-typed search — reachable either by typing in the results
  // panel (whether or not an AI search has already run) or via "Type to
  // search instead" in the crop overlay, which skips cropping entirely.
  async function handleManualSearch(query: string) {
    setShowCrop(false);
    setShowResults(true);
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults(null);
    setIdentification(query);
    setMatchedQuery(null);
    try {
      const res = await api.marketplaceSearch(query);
      setSearchResults(res.results);
      setMatchedQuery(res.matchedQuery);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearchLoading(false);
    }
  }

  // Opens the results panel directly in manual-search mode, skipping the
  // crop step — used by "Type to search instead" in the crop overlay. The
  // video is already paused from openCrop(), so no extra pause is needed.
  function openManualSearch() {
    setShowCrop(false);
    setShowResults(true);
    setSearchLoading(false);
    setSearchError(null);
    setSearchResults(null);
    setIdentification(null);
    setMatchedQuery(null);
  }

  function addToCart(result: VisualSearchResult) {
    setCart((prev) => {
      if (prev.some((i) => i.productId === result.id)) return prev;
      return [
        ...prev,
        { productId: result.id, name: result.name, price: result.price, image: result.image, quantity: 1, sellerId: result.sellerId },
      ];
    });
  }

  function handleCheckoutComplete(remainingProductIds: string[]) {
    setCart((prev) => prev.filter((i) => remainingProductIds.includes(i.productId)));
    resumeWatching();
  }

  useEffect(() => {
    return () => cancelAnimationFrame(holdRafRef.current);
  }, []);

  return (
    <div className="relative h-full w-full snap-start flex items-center justify-center bg-black">
      <video
        ref={videoRef}
        src={mediaUrl(video.url)}
        poster={mediaUrl(video.poster)}
        loop
        muted={muted}
        playsInline
        crossOrigin="anonymous"
        onClick={handleVideoClick}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="h-full w-full object-contain"
      />

      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-full bg-black/40 flex items-center justify-center text-white">
            <Play size={28} fill="currentColor" strokeWidth={0} className="ml-1" />
          </div>
        </div>
      )}

      {/* Long-press-to-download ring — fills over LONG_PRESS_MS while
          the video is held, giving visible feedback for the gesture. */}
      {holdProgress > 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <svg width="72" height="72" viewBox="0 0 72 72" className="drop-shadow-lg">
            <circle cx="36" cy="36" r="30" fill="rgba(0,0,0,0.35)" />
            <circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="4" />
            <circle
              cx="36"
              cy="36"
              r="30"
              fill="none"
              stroke="url(#piitradeHoldGradient)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 30}
              strokeDashoffset={2 * Math.PI * 30 * (1 - holdProgress)}
              transform="rotate(-90 36 36)"
            />
            <defs>
              <linearGradient id="piitradeHoldGradient" x1="0" y1="0" x2="72" y2="72">
                <stop offset="0%" stopColor="#ff2d78" />
                <stop offset="100%" stopColor="#22d3ee" />
              </linearGradient>
            </defs>
            <foreignObject x="6" y="6" width="60" height="60">
              <div className="w-full h-full flex items-center justify-center text-white">
                <Download size={22} />
              </div>
            </foreignObject>
          </svg>
        </div>
      )}

      {/* Watermark render progress — shown while the branded copy is
          being produced after either the button or the long-press. */}
      {downloading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 pointer-events-none">
          <span className="text-white text-xs font-semibold tracking-wide">Adding piitrade.com watermark…</span>
          <div className="w-40 h-1.5 rounded-full bg-white/20 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-brand-pink to-brand-cyan transition-all"
              style={{ width: `${Math.round(downloadProgress * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Brief branded confirmation once a watermarked download completes. */}
      {downloadFlash && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="animate-pulse bg-black/60 rounded-full px-4 py-2 flex items-center gap-2 text-white text-xs font-semibold">
            <Download size={14} className="text-brand-cyan" /> Saved with piitrade.com watermark
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? 'Unmute video' : 'Mute video'}
        className="tap-target safe-right absolute top-4 right-4 text-white bg-black/30 rounded-full flex items-center justify-center"
      >
        {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
      </button>

      {active && showSoundHint && (
        <div
          className="safe-right absolute top-4 right-16 sm:right-20 flex items-center pointer-events-none animate-pulse"
          aria-hidden="true"
        >
          <span className="bg-black/60 text-white text-xs font-medium rounded-full px-3 py-1.5 whitespace-nowrap">
            Tap for sound 🔊
          </span>
        </div>
      )}

      <div className="safe-left safe-bottom absolute left-3 right-16 sm:right-20 bottom-4 text-white">
        {video.uploader && (
          <Link
            to={`/u/${video.uploader.handle}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-block text-xs font-semibold text-white/90 drop-shadow mb-1 hover:underline"
          >
            @{video.uploader.displayName || video.uploader.handle}
          </Link>
        )}
        <p className="font-semibold text-sm drop-shadow break-words">{video.title}</p>
        {video.description && <p className="text-xs text-white/80 mt-1 line-clamp-2 drop-shadow">{video.description}</p>}
      </div>

      <div className="safe-right safe-bottom absolute right-2 sm:right-3 bottom-4 flex flex-col items-center gap-3 sm:gap-5">
        <button
          type="button"
          onClick={handleLike}
          aria-label={liked ? 'Unlike' : 'Like'}
          aria-pressed={liked}
          className="tap-target flex flex-col items-center justify-center text-white"
        >
          <Heart
            size={26}
            className={`transition-transform ${liked ? 'scale-110 text-brand-pink' : ''}`}
            fill={liked ? 'currentColor' : 'none'}
            strokeWidth={liked ? 0 : 2}
          />
          <span className="text-xs mt-1">{formatCount(likes)}</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowComments(true);
          }}
          aria-label="View comments"
          className="tap-target flex flex-col items-center justify-center text-white"
        >
          <MessageCircle size={26} />
          <span className="text-xs mt-1">{formatCount(commentCount)}</span>
        </button>
        <button
          type="button"
          onClick={handleFavorite}
          aria-label={favorited ? 'Remove from favorites' : 'Favorite'}
          aria-pressed={favorited}
          className="tap-target flex flex-col items-center justify-center text-white"
        >
          <Bookmark
            size={26}
            className={favorited ? 'text-brand-cyan' : ''}
            fill={favorited ? 'currentColor' : 'none'}
            strokeWidth={favorited ? 0 : 2}
          />
          <span className="text-xs mt-1">Favorite</span>
        </button>
        <button
          type="button"
          onClick={openCrop}
          aria-label="Search similar products in this frame"
          className="tap-target flex flex-col items-center justify-center text-white"
        >
          <Search size={26} />
          <span className="text-xs mt-1">Search</span>
        </button>
        <button
          type="button"
          onClick={handleDownload}
          aria-label="Download video"
          aria-pressed={saved}
          className="tap-target flex flex-col items-center justify-center text-white"
        >
          <Download size={26} className={saved ? 'text-brand-cyan' : ''} />
          <span className="text-xs mt-1">Download</span>
        </button>
      </div>

      {showCrop && videoRef.current && (
        <CropOverlay
          videoEl={videoRef.current}
          onCancel={resumeWatching}
          onCropped={handleCropped}
          onManualSearch={openManualSearch}
        />
      )}
      {showResults && (
        <>
          <SearchResultsPanel
            loading={searchLoading}
            error={searchError}
            results={searchResults}
            identification={identification}
            matchedQuery={matchedQuery}
            cartProductIds={new Set(cart.map((c) => c.productId))}
            onAddToCart={addToCart}
            onManualSearch={handleManualSearch}
            onClose={resumeWatching}
          />
          <CartBar items={cart} onCheckout={() => setShowCheckout(true)} />
        </>
      )}
      {showCheckout && (
        <CheckoutModal items={cart} onCancel={resumeWatching} onComplete={handleCheckoutComplete} />
      )}
      {showComments && (
        <CommentModal videoId={video.id} onClose={() => setShowComments(false)} onCommentPosted={setCommentCount} />
      )}
    </div>
  );
}
