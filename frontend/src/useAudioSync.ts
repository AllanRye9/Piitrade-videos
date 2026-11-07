import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** The audio being previewed over a video in the upload editor. */
export interface AudioPreview {
  /** Object URL of the chosen audio file, or null when the browser can't decode it. */
  url: string | null;
  /** Where in the audio the clip starts, in seconds. */
  start: number;
  /** Volume of the video's own sound, 0–1. */
  videoVolume: number;
  /** Volume of the added audio, 0–1. */
  audioVolume: number;
}

/**
 * Plays the added audio in step with a preview <video>, so the uploader
 * hears roughly what will be posted: the video at its volume plus the
 * audio at its volume, starting from the chosen point in the audio.
 *
 * The audio simply follows the video — it plays, pauses and seeks with
 * it, and is nudged back into line if it drifts. `clipStart` is where
 * the posted clip begins inside the source video (the trim start), so
 * the audio's position is always `audio.start + (time - clipStart)`.
 * When the trim editor loops the selection it seeks the video back to
 * the start, which re-aligns the audio the same way.
 *
 * Preview only: the real mix is made on the server. (Browsers cap
 * media volume at 100%, so the preview can't go louder than that.)
 */
export function useAudioSync(videoRef: RefObject<HTMLVideoElement | null>, audio: AudioPreview | null, clipStart: number, muted: boolean) {
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const latest = useRef({ start: audio?.start ?? 0, clipStart });
  latest.current = { start: audio?.start ?? 0, clipStart };
  const url = audio?.url ?? null;

  // One <audio> element per chosen file.
  useEffect(() => {
    if (!url) {
      audioElRef.current = null;
      return;
    }
    const el = new Audio(url);
    el.preload = 'auto';
    audioElRef.current = el;
    return () => {
      el.pause();
      el.removeAttribute('src');
      el.load();
      if (audioElRef.current === el) audioElRef.current = null;
    };
  }, [url]);

  // Volumes (and mute) apply to both sounds.
  const videoVolume = audio?.videoVolume ?? 1;
  const audioVolume = audio?.audioVolume ?? 1;
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.volume = Math.min(1, Math.max(0, videoVolume));
    const a = audioElRef.current;
    if (a) {
      a.volume = Math.min(1, Math.max(0, audioVolume));
      a.muted = muted;
    }
  }, [videoRef, videoVolume, audioVolume, muted, url]);

  // Follow the video.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !url) return;

    const target = () => latest.current.start + Math.max(0, v.currentTime - latest.current.clipStart);

    const align = () => {
      const a = audioElRef.current;
      if (!a) return;
      try {
        a.currentTime = target();
      } catch {
        // metadata not loaded yet — the next event will retry
      }
    };
    const onPlay = () => {
      const a = audioElRef.current;
      if (!a) return;
      align();
      a.play().catch(() => {});
    };
    const onPause = () => audioElRef.current?.pause();
    const onTime = () => {
      const a = audioElRef.current;
      if (!a || v.paused) return;
      if (Math.abs(a.currentTime - target()) > 0.35) align();
    };

    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', align);
    v.addEventListener('timeupdate', onTime);
    // Already playing when the audio is added (plain preview with controls).
    if (!v.paused) onPlay();
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', align);
      v.removeEventListener('timeupdate', onTime);
      audioElRef.current?.pause();
    };
  }, [videoRef, url]);

  // Moving the audio's start point re-aligns immediately.
  const start = audio?.start ?? 0;
  useEffect(() => {
    const a = audioElRef.current;
    const v = videoRef.current;
    if (!a || !v) return;
    try {
      a.currentTime = start + Math.max(0, v.currentTime - clipStart);
    } catch {
      // ignore until metadata is loaded
    }
  }, [videoRef, start, clipStart, url]);
}
