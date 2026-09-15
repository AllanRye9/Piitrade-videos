import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import type { Video } from '../types';
import { api } from '../api';
import { mediaUrl, API_BASE } from '../config';
import CropOverlay from './CropOverlay';
import SearchResultsPanel from './SearchResultsPanel';
import CartBar from './CartBar';
import CheckoutModal from './CheckoutModal';
import CommentModal from './CommentModal';
import Avatar from './Avatar';
import type { VisualSearchResult } from '../types';
import { getMuted, setMuted as setSharedMuted, subscribeMuted } from '../soundPreference';
import { getCart, subscribeCart, addToCart as addToCartStore, removeFromCart, keepOnlyInCart } from '../cartStore';
import { Heart, MessageCircle, Bookmark, Search, Download, Volume2, VolumeX, Play } from 'lucide-react';

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
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);
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
  const cart = useSyncExternalStore(subscribeCart, getCart);
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
      el.playbackRate = 1;
      setPlaybackRate(1);
    }
  }, [active]);

  // Prevent a pending long-press timer from firing after this card
  // unmounts (e.g. scrolled away mid-hold).
  useEffect(() => cancelLongPress, []);

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

  // Holding the video for 3+ seconds opens a playback-speed control,
  // without interrupting playback — a quick tap still just plays/pauses.
  const LONG_PRESS_MS = 3000;

  function handleVideoPointerDown() {
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setShowSpeedMenu(true);
    }, LONG_PRESS_MS);
  }

  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function handleVideoClick() {
    // The long press already opened the speed menu — swallow the click
    // that follows pointerup so it doesn't also toggle play/pause.
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }
    togglePlay();
  }

  function changePlaybackRate(rate: number) {
    const el = videoRef.current;
    if (el) el.playbackRate = rate;
    setPlaybackRate(rate);
    setShowSpeedMenu(false);
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

  // "Download" — saves a piitrade.com-watermarked copy of the video
  // (see backend GET /api/videos/:id/download) to the device, distinct
  // from the plain file used for in-app playback, AND records the
  // server-side `saved` flag (the same field the Profile page's
  // Downloads tab reads back), so the two stay in sync instead of the
  // button doing a local browser download that no other part of the
  // app knows happened.
  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = `${API_BASE}/api/videos/${video.id}/download`;
    a.download = `${video.title || 'video'}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();

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
    addToCartStore({
      productId: result.id,
      name: result.name,
      price: result.price,
      image: result.image,
      quantity: 1,
      sellerId: result.sellerId,
      sellerName: result.sellerName,
      sellerContact: result.sellerContact,
    });
  }

  function handleCheckoutComplete(remainingProductIds: string[]) {
    keepOnlyInCart(remainingProductIds);
    resumeWatching();
  }

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
        onPointerDown={handleVideoPointerDown}
        onPointerUp={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onPointerCancel={cancelLongPress}
        className="h-full w-full object-contain"
      />

      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-full bg-black/40 flex items-center justify-center text-white">
            <Play size={28} fill="currentColor" strokeWidth={0} className="ml-1" />
          </div>
        </div>
      )}

      {playbackRate !== 1 && !showSpeedMenu && (
        <div className="absolute top-3 left-3 bg-black/50 rounded-full px-2 py-0.5 text-white text-[11px] font-semibold pointer-events-none">
          {playbackRate}x
        </div>
      )}

      {showSpeedMenu && (
        <div
          className="absolute inset-0 z-30 bg-black/60 flex items-center justify-center"
          onClick={() => setShowSpeedMenu(false)}
        >
          <div
            className="bg-neutral-900 rounded-2xl p-2 flex flex-col gap-1 min-w-[140px]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-white/50 text-[11px] text-center px-3 py-1">Playback speed</p>
            {[0.5, 1, 1.25, 1.5, 2].map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => changePlaybackRate(rate)}
                className={`px-4 py-2 rounded-lg text-sm text-center ${
                  rate === playbackRate ? 'bg-brand-cyan text-black font-semibold' : 'text-white'
                }`}
              >
                {rate}x
              </button>
            ))}
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
        {video.uploaderSessionId && (
          <Link
            to={`/creator/${video.uploaderSessionId}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 mb-1.5"
          >
            <Avatar src={video.uploaderAvatar} size={22} alt={video.uploaderDisplayName || 'Creator'} />
            <span className="text-xs font-medium drop-shadow">{video.uploaderDisplayName || 'Unnamed creator'}</span>
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
            onRemoveFromCart={removeFromCart}
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
