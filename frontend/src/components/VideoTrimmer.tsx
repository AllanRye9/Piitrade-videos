import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Volume2, VolumeX, RotateCcw } from 'lucide-react';
import type { TrimRange } from '../api';
import { useAudioSync } from '../useAudioSync';
import type { AudioPreview } from '../useAudioSync';

interface Props {
  /** Object URL of the chosen file, or null when this browser can't
   *  decode it (e.g. .mkv/.avi/.wmv) — the editor then falls back to a
   *  start-time slider with no preview. The server does the real cut
   *  either way. */
  previewUrl: string | null;
  /** Length of the whole source video, in seconds. */
  duration: number;
  /** Longest clip that may be posted, in seconds. */
  maxSeconds: number;
  value: TrimRange;
  onChange: (next: TrimRange) => void;
  /** Audio the uploader added — played along with the preview so they can hear the mix. */
  audio?: AudioPreview | null;
}

/** Shortest clip the editor allows — keep in sync with MIN_VIDEO_SECONDS on the backend. */
const MIN_SECONDS = 1;

type DragMode = 'start' | 'end' | 'move';

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}

/**
 * Trim editor shown in the upload dialog when a video is longer than
 * the 30-second limit. The uploader drags a window over a timeline of
 * the whole video — by either end to resize it, or by the middle to
 * slide it — and the window can never be longer than `maxSeconds`.
 * The preview loops just the selected part, so what they see is what
 * gets posted. Nothing is re-encoded in the browser: the chosen
 * start/end are sent with the upload and the server cuts the file.
 */
export default function VideoTrimmer({ previewUrl, duration, maxSeconds, value, onChange, audio = null }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: DragMode; originX: number; origin: TrimRange } | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const [playing, setPlaying] = useState(false);
  // Not muted by default: the preview only ever plays after the uploader
  // taps Play, so sound is allowed, and with added audio it's the point.
  const [muted, setMuted] = useState(false);
  const [previewBroken, setPreviewBroken] = useState(false);

  useAudioSync(videoRef, audio, value.start, muted);

  const length = value.end - value.start;
  const hasPreview = Boolean(previewUrl) && !previewBroken;

  const seek = useCallback((t: number) => {
    const el = videoRef.current;
    if (el && Number.isFinite(t)) el.currentTime = clamp(t, 0, Math.max(0, duration - 0.05));
  }, [duration]);

  // Start at the beginning of the selection whenever a new file is shown.
  useEffect(() => {
    seek(value.start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl]);

  // While playing: keep the playhead moving and loop inside the
  // selected window. requestAnimationFrame (not the coarse ~4Hz
  // `timeupdate` event) so the loop point is tight and the playhead
  // is smooth — it writes straight to the DOM to avoid re-rendering
  // this component 60 times a second.
  useEffect(() => {
    if (!playing || !hasPreview) return;
    let raf = 0;
    const tick = () => {
      const el = videoRef.current;
      const v = valueRef.current;
      if (el) {
        if (el.currentTime >= v.end - 0.03 || el.currentTime < v.start - 0.3) {
          el.currentTime = v.start;
        }
        if (playheadRef.current) {
          playheadRef.current.style.left = `${(el.currentTime / duration) * 100}%`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, hasPreview, duration]);

  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      if (el.currentTime >= value.end - 0.05 || el.currentTime < value.start) el.currentTime = value.start;
      el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
    }
  }

  function update(next: TrimRange, previewAt: 'start' | 'end') {
    onChange(next);
    if (hasPreview) {
      // Show the frame at the edge being dragged, so the uploader can
      // see exactly where the clip will begin or end.
      seek(previewAt === 'start' ? next.start : Math.max(next.start, next.end - 0.1));
    }
  }

  // ---- dragging -----------------------------------------------------

  function beginDrag(mode: DragMode, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { mode, originX: e.clientX, origin: { ...valueRef.current } };
    videoRef.current?.pause();
    setPlaying(false);
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    const track = trackRef.current;
    if (!drag || !track) return;
    const secondsPerPx = duration / track.getBoundingClientRect().width;
    const delta = (e.clientX - drag.originX) * secondsPerPx;
    const { start, end } = drag.origin;

    if (drag.mode === 'start') {
      const nextStart = clamp(start + delta, Math.max(0, end - maxSeconds), end - MIN_SECONDS);
      update({ start: round(nextStart), end }, 'start');
    } else if (drag.mode === 'end') {
      const nextEnd = clamp(end + delta, start + MIN_SECONDS, Math.min(duration, start + maxSeconds));
      update({ start, end: round(nextEnd) }, 'end');
    } else {
      const len = end - start;
      const nextStart = clamp(start + delta, 0, duration - len);
      update({ start: round(nextStart), end: round(nextStart + len) }, 'start');
    }
  }

  function endDrag() {
    dragRef.current = null;
  }

  function onHandleKey(mode: 'start' | 'end', e: React.KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowLeft' ? -1 : 1);
    const { start, end } = valueRef.current;
    if (mode === 'start') {
      update({ start: round(clamp(start + step, Math.max(0, end - maxSeconds), end - MIN_SECONDS)), end }, 'start');
    } else {
      update({ start, end: round(clamp(end + step, start + MIN_SECONDS, Math.min(duration, start + maxSeconds))) }, 'end');
    }
  }

  function resetToFirstWindow() {
    update({ start: 0, end: Math.min(duration, maxSeconds) }, 'start');
  }

  // ---- fallback: no in-browser preview ------------------------------

  if (!hasPreview) {
    const maxStart = Math.max(0, duration - MIN_SECONDS);
    return (
      <div className="rounded-xl bg-neutral-800 p-4 space-y-3">
        <p className="text-white text-sm font-medium">Choose which {maxSeconds} seconds to post</p>
        <p className="text-white/50 text-xs">
          This video is {Math.round(duration)}s long and your browser can't preview this format, so pick where the clip
          should start — we'll keep up to {maxSeconds}s from there.
        </p>
        <label className="block">
          <span className="flex justify-between text-xs text-white/60 mb-1">
            <span>Start at {formatTime(value.start)}</span>
            <span>
              Keeps {formatTime(value.start)} – {formatTime(value.end)} ({round(length)}s)
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={maxStart}
            step={0.5}
            value={value.start}
            onChange={(e) => {
              const start = Number(e.target.value);
              onChange({ start, end: round(Math.min(duration, start + maxSeconds)) });
            }}
            aria-label="Clip start time"
            className="w-full accent-brand-orange"
          />
        </label>
      </div>
    );
  }

  // ---- full editor --------------------------------------------------

  const startPct = (value.start / duration) * 100;
  const widthPct = (length / duration) * 100;

  return (
    <div className="space-y-3">
      <div className="relative rounded-xl overflow-hidden bg-black">
        <video
          ref={videoRef}
          src={previewUrl ?? undefined}
          muted={muted}
          playsInline
          preload="auto"
          onError={() => setPreviewBroken(true)}
          onEnded={() => {
            // Safety net — the rAF loop normally wraps before this fires.
            seek(valueRef.current.start);
            videoRef.current?.play().catch(() => setPlaying(false));
          }}
          className="w-full max-h-[34vh] sm:max-h-[40vh] object-contain mx-auto"
        />
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          className="absolute inset-0 flex items-center justify-center"
        >
          {!playing && (
            <span className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center text-white">
              <Play size={22} fill="currentColor" strokeWidth={0} className="ml-0.5" />
            </span>
          )}
        </button>
        <div className="absolute right-2 bottom-2 flex gap-2">
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Unmute preview' : 'Mute preview'}
            className="tap-target w-9 h-9 min-w-0 min-h-0 rounded-full bg-black/50 text-white flex items-center justify-center"
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>
      </div>

      {/* Timeline of the WHOLE video; the lit window is what gets posted. */}
      <div
        ref={trackRef}
        className="relative h-14 mx-5 rounded-lg bg-white/10 select-none touch-none"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* dimmed regions outside the window */}
        <div className="absolute inset-y-0 left-0 bg-black/55 rounded-l-lg pointer-events-none" style={{ width: `${startPct}%` }} />
        <div
          className="absolute inset-y-0 right-0 bg-black/55 rounded-r-lg pointer-events-none"
          style={{ width: `${100 - startPct - widthPct}%` }}
        />

        {/* the selected window — drag the middle to slide it */}
        <div
          onPointerDown={(e) => beginDrag('move', e)}
          className="absolute inset-y-0 border-y-2 border-brand-orange bg-brand-orange/15 cursor-grab active:cursor-grabbing"
          style={{ left: `${startPct}%`, width: `${widthPct}%` }}
        >
          <div
            role="slider"
            tabIndex={0}
            aria-label="Clip start"
            aria-valuemin={Math.max(0, value.end - maxSeconds)}
            aria-valuemax={value.end - MIN_SECONDS}
            aria-valuenow={value.start}
            aria-valuetext={formatTime(value.start)}
            onKeyDown={(e) => onHandleKey('start', e)}
            onPointerDown={(e) => beginDrag('start', e)}
            className="absolute -left-5 inset-y-0 w-5 flex items-center justify-end cursor-ew-resize touch-none"
          >
            <span className="h-full w-3 rounded-l-md bg-brand-orange flex items-center justify-center">
              <span className="w-0.5 h-5 rounded bg-white/90" />
            </span>
          </div>
          <div
            role="slider"
            tabIndex={0}
            aria-label="Clip end"
            aria-valuemin={value.start + MIN_SECONDS}
            aria-valuemax={Math.min(duration, value.start + maxSeconds)}
            aria-valuenow={value.end}
            aria-valuetext={formatTime(value.end)}
            onKeyDown={(e) => onHandleKey('end', e)}
            onPointerDown={(e) => beginDrag('end', e)}
            className="absolute -right-5 inset-y-0 w-5 flex items-center justify-start cursor-ew-resize touch-none"
          >
            <span className="h-full w-3 rounded-r-md bg-brand-orange flex items-center justify-center">
              <span className="w-0.5 h-5 rounded bg-white/90" />
            </span>
          </div>
        </div>

        <div
          ref={playheadRef}
          className="absolute inset-y-0 w-0.5 bg-white pointer-events-none"
          style={{ left: `${startPct}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-white/60">{formatTime(value.start)}</span>
        <span className={`font-semibold ${length > maxSeconds + 0.05 ? 'text-red-400' : 'text-white'}`}>
          {round(length)}s <span className="text-white/40 font-normal">of {maxSeconds}s max</span>
        </span>
        <span className="text-white/60">{formatTime(value.end)}</span>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-white/40 text-[11px]">Drag the ends to trim, or drag the middle to slide the clip.</p>
        <button
          type="button"
          onClick={resetToFirstWindow}
          className="flex items-center gap-1 text-[11px] text-white/60 underline shrink-0 ml-3"
        >
          <RotateCcw size={11} /> Reset
        </button>
      </div>
    </div>
  );
}
