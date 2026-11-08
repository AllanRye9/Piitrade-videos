import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import type { Video } from '../types';
import { api } from '../api';
import { mediaUrl } from '../config';
import CropOverlay from './CropOverlay';
import SearchResultsPanel from './SearchResultsPanel';
import VideoMoreSheet from './VideoMoreSheet';
import CommentModal from './CommentModal';
import type { VisualSearchResult } from '../types';
import { getMuted, setMuted as setSharedMuted, subscribeMuted } from '../soundPreference';
import { renderWatermarkedVideo, triggerBlobDownload } from '../videoWatermark';
import { Heart, MessageCircle, Search, Download, Volume2, VolumeX, Play, Share2, MoreHorizontal } from 'lucide-react';

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

const HASHTAG_TOKEN = /#([a-z0-9_]{1,30})/gi;

/** Renders `text` with any #hashtag substrings turned into links to
 *  /tag/:tag, so a caption's hashtags are tappable exactly where they
 *  appear rather than duplicated as a separate chip row underneath —
 *  matches the TikTok/Instagram convention this feature is based on. */
function linkifyHashtags(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of text.matchAll(HASHTAG_TOKEN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push(text.slice(lastIndex, index));
    parts.push(
      <Link
        key={key++}
        to={`/tag/${match[1].toLowerCase()}`}
        onClick={(e) => e.stopPropagation()}
        className="text-brand-amber font-medium hover:underline"
      >
        #{match[1]}
      </Link>
    );
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
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
  const [shareCount, setShareCount] = useState(video.shares);
  const [shareFlash, setShareFlash] = useState<'shared' | 'copied' | null>(null);
  const [showCrop, setShowCrop] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [progress, setProgress] = useState(0); // 0–1 playback position
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<VisualSearchResult[] | null>(null);
  const [identification, setIdentification] = useState<string | null>(null);
  const [matchedQuery, setMatchedQuery] = useState<string | null>(null);
  const [browseUrl, setBrowseUrl] = useState<string | null>(null);

  // Long-press-to-download control: holding the video for
  // LONG_PRESS_MS shows a filling ring, then triggers the same
  // watermarked download as the Download button.
  const [holdProgress, setHoldProgress] = useState(0); // 0–1 while holding
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0); // 0–1 while rendering the watermark
  const [downloadFlash, setDownloadFlash] = useState(false); // brief branded confirmation

  const [reported, setReported] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);

  async function submitReport(reason: 'spam' | 'inappropriate' | 'copyright' | 'other') {
    setReportBusy(true);
    try {
      await api.reportVideo(video.id, reason);
      setReported(true);
    } catch {
      // Reporting failing silently is preferable to blocking the rest
      // of the viewing experience over it — the button just stays
      // clickable so they can try again.
    } finally {
      setReportBusy(false);
    }
  }
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

  // Shown once, ever, until the viewer taps Find for the first
  // time — crop-to-find has no real-world equivalent for someone who's
  // never seen it before, unlike the mute icon (a near-universal
  // symbol), so it needs an explicit one-line explanation rather than
  // relying on the icon alone. Same one-flag-in-localStorage pattern
  // as the sound hint above, and intentionally similarly brief.
  const [showSearchHint, setShowSearchHint] = useState(
    () => typeof localStorage === 'undefined' || localStorage.getItem('piitrade_search_hint_seen') !== 'true'
  );

  function dismissSearchHint() {
    setShowSearchHint(false);
    try {
      localStorage.setItem('piitrade_search_hint_seen', 'true');
    } catch {
      // ignore
    }
  }

  // Auto-hides after a few seconds rather than lingering indefinitely.
  // Not marked "seen" by the timer itself, only by actually using
  // Find — so it still shows again on a future visit if they haven't.
  // (Holding the video to download used to have its own hint bubble;
  // it's explained in the More sheet instead, to keep the video clear.)
  useEffect(() => {
    if (!active || !showSearchHint) return;
    const t = setTimeout(() => setShowSearchHint(false), 4000);
    return () => clearTimeout(t);
  }, [active, showSearchHint]);

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
  async function handleFavorite(e?: React.MouseEvent) {
    e?.stopPropagation();
    setFavorited((f) => !f);
    try {
      const res = await api.favorite(video.id);
      setFavorited(res.favorited);
    } catch {
      setFavorited((f) => !f);
    }
  }

  // The permalink is what makes this shareable at all — before this
  // feature, a video only existed as a card inside the feed's own
  // scroll state, with no URL that pointed at just it. Uses the
  // native share sheet (WhatsApp/Instagram/etc. all show up in it for
  // free on mobile) where available, falling back to copying the link
  // on browsers without Web Share support (desktop, mostly).
  async function handleShare(e: React.MouseEvent) {
    e.stopPropagation();
    const url = `${window.location.origin}/v/${video.id}`;
    const shareData = { title: video.title || 'Piitrade video', text: 'Watch this on Piitrade Videos', url };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        setShareFlash('shared');
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setShareFlash('copied');
      } else {
        return; // nothing usable on this browser — fail quietly rather than error
      }
    } catch {
      // Covers the user dismissing the native share sheet, which
      // rejects the promise — that's a cancel, not a failure, so no
      // error state and no share is counted below.
      return;
    }

    setShareCount((c) => c + 1);
    setTimeout(() => setShareFlash(null), 1600);
    api.shareVideo(video.id).catch(() => {
      // Non-fatal — the share already happened from the viewer's
      // perspective (sheet opened / link copied); losing the count
      // increment isn't worth surfacing an error over.
    });
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
    dismissSearchHint();
    const el = videoRef.current;
    if (!el) return;
    // Pause for the whole find-on-Piitrade flow. Only resumed again
    // by resumeWatching(), on cancel or close — never permanently.
    wasPlayingRef.current = !el.paused;
    el.pause();
    setPlaying(false);
    setShowCrop(true);
  }

  function resumeWatching() {
    const el = videoRef.current;
    setShowCrop(false);
    setShowResults(false);
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
    setBrowseUrl(null);
    try {
      const res = await api.visualSearch(blob);
      setSearchResults(res.results);
      setIdentification(res.identification ?? null);
      setMatchedQuery(res.matchedQuery ?? null);
      setBrowseUrl(res.browseUrl ?? null);
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
    setBrowseUrl(null);
    try {
      const res = await api.marketplaceSearch(query);
      setSearchResults(res.results);
      setMatchedQuery(res.matchedQuery ?? null);
      setBrowseUrl(res.browseUrl ?? null);
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

  useEffect(() => {
    return () => cancelAnimationFrame(holdRafRef.current);
  }, []);

  const hasLongDescription = Boolean(video.description) && video.description.length > 70;

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
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (el.duration > 0) setProgress(el.currentTime / el.duration);
        }}
        className="h-full w-full object-contain"
      />

      {/* Soft bottom shade so the caption and action icons stay legible
          on bright frames. Shorter than before — the video is the
          point, so the shade only covers the caption area. */}
      <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/70 via-black/20 to-transparent pointer-events-none" />

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
                <stop offset="0%" stopColor="#F55906" />
                <stop offset="100%" stopColor="#FFB347" />
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
          <span className="text-white text-xs font-semibold tracking-wide">Processing download…</span>
          <div className="w-40 h-1.5 rounded-full bg-white/20 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-brand-orange to-brand-amber transition-all"
              style={{ width: `${Math.round(downloadProgress * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Brief branded confirmation once a watermarked download completes. */}
      {downloadFlash && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="animate-pulse bg-black/60 rounded-full px-4 py-2 flex items-center gap-2 text-white text-xs font-semibold">
            <Download size={14} className="text-brand-amber" /> Saved with piitrade.com watermark
          </div>
        </div>
      )}

      {shareFlash && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/60 rounded-full px-4 py-2 flex items-center gap-2 text-white text-xs font-semibold">
            <Share2 size={14} className="text-brand-amber" /> {shareFlash === 'copied' ? 'Link copied' : 'Shared'}
          </div>
        </div>
      )}

      {/* The header now sits OUTSIDE the video stage (see App.tsx), so the
          mute button can live in the video's own top corner instead of
          being pushed down to clear overlaid controls. */}
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? 'Unmute video' : 'Mute video'}
        className="tap-target absolute top-3 right-3 text-white bg-black/35 rounded-full flex items-center justify-center"
      >
        {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
      </button>

      {active && showSoundHint && (
        <div className="absolute top-3 right-16 flex items-center pointer-events-none animate-pulse" aria-hidden="true">
          <span className="bg-black/60 text-white text-xs font-medium rounded-full px-3 py-1.5 whitespace-nowrap">
            Tap for sound 🔊
          </span>
        </div>
      )}

      {/* Caption: creator, title, and the description only on demand. */}
      <div className="safe-left safe-bottom absolute left-3 right-16 bottom-4 text-white">
        {video.uploader && (
          <Link
            to={`/u/${video.uploader.handle}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-block text-sm font-semibold text-white drop-shadow mb-0.5 hover:underline"
          >
            @{video.uploader.displayName || video.uploader.handle}
          </Link>
        )}
        <p className="text-sm drop-shadow break-words line-clamp-2">{linkifyHashtags(video.title)}</p>
        {video.description && (
          <>
            <p className={`text-xs text-white/80 mt-1 drop-shadow ${expanded ? '' : 'line-clamp-1'}`}>
              {linkifyHashtags(video.description)}
            </p>
            {(hasLongDescription || expanded) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((v) => !v);
                }}
                className="text-[11px] font-semibold text-white/70 mt-0.5"
              >
                {expanded ? 'less' : 'more'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Action rail — down from seven stacked buttons to five. Favorite,
          Download and Report moved into the More sheet. */}
      <div className="safe-right safe-bottom absolute right-2 bottom-4 flex flex-col items-center gap-3 drop-shadow-md">
        <button
          type="button"
          onClick={handleLike}
          aria-label={liked ? 'Unlike' : 'Like'}
          aria-pressed={liked}
          className="tap-target flex flex-col items-center justify-center text-white"
        >
          <Heart
            size={26}
            className={`transition-transform ${liked ? 'scale-110 text-brand-orange' : ''}`}
            fill={liked ? 'currentColor' : 'none'}
            strokeWidth={liked ? 0 : 2}
          />
          <span className="text-[11px] mt-0.5">{formatCount(likes)}</span>
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
          <span className="text-[11px] mt-0.5">{formatCount(commentCount)}</span>
        </button>
        <button
          type="button"
          onClick={handleShare}
          aria-label="Share this video"
          className="tap-target flex flex-col items-center justify-center text-white"
        >
          <Share2 size={26} />
          <span className="text-[11px] mt-0.5">{formatCount(shareCount)}</span>
        </button>
        <button
          type="button"
          onClick={openCrop}
          aria-label="Find what you see on Piitrade"
          className="flex flex-col items-center justify-center text-white relative"
        >
          <span className="w-11 h-11 rounded-full bg-brand-orange flex items-center justify-center shadow-lg shadow-black/30">
            <Search size={22} />
          </span>
          <span className="text-[11px] mt-0.5 font-semibold">Find</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowMore(true);
          }}
          aria-label="More actions"
          className="tap-target flex items-center justify-center text-white"
        >
          <MoreHorizontal size={26} />
        </button>

        {/* One-time hint, shown ABOVE the whole rail (clear video, nothing
            to cover) rather than beside Find, where it landed on the caption
            or on the Share count depending on screen size. */}
        {active && showSearchHint && (
          <span
            className="absolute bottom-full right-0 mb-3 bg-black/70 text-white text-xs font-medium rounded-full px-3 py-1.5 whitespace-nowrap animate-pulse pointer-events-none"
            aria-hidden="true"
          >
            Tap Find to see it on Piitrade ↓
          </span>
        )}
      </div>

      {/* Thin playback line along the bottom edge — useful for a
          30-second clip, and takes almost no room. */}
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20 pointer-events-none">
        <div className="h-full bg-brand-orange" style={{ width: `${progress * 100}%` }} />
      </div>

      {showMore && (
        <VideoMoreSheet
          favorited={favorited}
          reported={reported}
          reportBusy={reportBusy}
          onFavorite={() => handleFavorite()}
          onDownload={downloadWithWatermark}
          onReport={submitReport}
          onClose={() => setShowMore(false)}
        />
      )}

      {showCrop && videoRef.current && (
        <CropOverlay
          videoEl={videoRef.current}
          onCancel={resumeWatching}
          onCropped={handleCropped}
          onManualSearch={openManualSearch}
        />
      )}
      {showResults && (
        <SearchResultsPanel
          loading={searchLoading}
          error={searchError}
          results={searchResults}
          identification={identification}
          matchedQuery={matchedQuery}
          browseUrl={browseUrl}
          onManualSearch={handleManualSearch}
          onClose={resumeWatching}
        />
      )}
      {showComments && (
        <CommentModal videoId={video.id} onClose={() => setShowComments(false)} onCommentPosted={setCommentCount} />
      )}
    </div>
  );
}
