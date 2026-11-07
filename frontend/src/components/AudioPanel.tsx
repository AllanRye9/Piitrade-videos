import { useRef } from 'react';
import { Music, X, Volume2, Mic } from 'lucide-react';

/** What the uploader chose, as held by the upload dialog. */
export interface AudioSelection {
  file: File;
  /** Object URL for previewing, or null when this browser can't decode the file. */
  url: string | null;
  /** Length of the audio in seconds, when the browser could read it. */
  duration: number | null;
  /** 0–1 */
  videoVolume: number;
  /** 0–1 */
  audioVolume: number;
  /** Seconds into the audio where it starts. */
  start: number;
}

interface Props {
  audio: AudioSelection | null;
  /** Length of the clip that will be posted, in seconds (the audio is cut to it). */
  clipLength: number | null;
  error: string | null;
  disabled?: boolean;
  /** Whether the dialog can play the video, so the mix can be previewed. */
  canPreview: boolean;
  onPick: (file: File) => void;
  onChange: (next: AudioSelection) => void;
  onRemove: () => void;
}

export const AUDIO_ACCEPT = '.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.weba,audio/*';

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

function SliderRow({
  icon,
  label,
  value,
  onChange,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const pct = Math.round(value * 100);
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs mb-1">
        <span className="flex items-center gap-1.5 text-white/70">
          {icon} {label}
        </span>
        <span className={`tabular-nums ${pct === 0 ? 'text-brand-orange font-semibold' : 'text-white/60'}`}>{pct === 0 ? 'Off' : `${pct}%`}</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        aria-label={`${label} volume`}
        className="w-full accent-brand-orange"
      />
    </label>
  );
}

/**
 * "Add audio" section of the upload editor. Choose an audio file, set how
 * loud it is against the video's own sound (Original sound at Off replaces
 * it), and pick where in the audio to start. The dialog previews the mix
 * with the video; the server makes the real one while processing.
 */
export default function AudioPanel({ audio, clipLength, error, disabled, canPreview, onPick, onChange, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={AUDIO_ACCEPT}
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onPick(f);
        e.target.value = '';
      }}
    />
  );

  if (!audio) {
    return (
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="w-full flex items-center gap-3 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 px-3.5 py-3 text-left disabled:opacity-50"
        >
          <span className="w-9 h-9 rounded-full bg-brand-orange/15 text-brand-orange flex items-center justify-center shrink-0">
            <Music size={18} />
          </span>
          <span className="min-w-0">
            <span className="block text-white text-sm font-medium">Add audio</span>
            <span className="block text-white/45 text-xs">Music or a voiceover — MP3, M4A, WAV and more</span>
          </span>
        </button>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        {input}
      </div>
    );
  }

  // The start slider only matters when there's more audio than clip.
  const canPickStart = audio.duration !== null && clipLength !== null && audio.duration > 1;
  const maxStart = audio.duration !== null ? Math.max(0, audio.duration - 1) : 0;
  const shortAudio = audio.duration !== null && clipLength !== null && audio.duration - audio.start < clipLength - 0.5;

  return (
    <div className="rounded-xl border border-white/15 bg-white/5 p-3.5 space-y-3.5">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-full bg-brand-orange/15 text-brand-orange flex items-center justify-center shrink-0">
          <Music size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-white text-sm font-medium truncate">{audio.file.name}</p>
          <p className="text-white/45 text-xs">
            {audio.duration !== null ? `${formatTime(audio.duration)} long` : 'Preview not available for this format'}
            {' · '}
            <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled} className="underline disabled:opacity-50">
              Change
            </button>
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label="Remove added audio"
          className="tap-target -mr-2 text-white/50 disabled:opacity-50"
        >
          <X size={18} />
        </button>
      </div>

      <SliderRow
        icon={<Mic size={13} />}
        label="Original sound"
        value={audio.videoVolume}
        disabled={disabled}
        onChange={(v) => onChange({ ...audio, videoVolume: v })}
      />
      <SliderRow
        icon={<Volume2 size={13} />}
        label="Added audio"
        value={audio.audioVolume}
        disabled={disabled}
        onChange={(v) => onChange({ ...audio, audioVolume: v })}
      />

      {canPickStart && (
        <label className="block">
          <span className="flex items-center justify-between text-xs mb-1">
            <span className="text-white/70">Start the audio at</span>
            <span className="tabular-nums text-white/60">{formatTime(audio.start)}</span>
          </span>
          <input
            type="range"
            min={0}
            max={maxStart}
            step={0.5}
            value={Math.min(audio.start, maxStart)}
            disabled={disabled}
            onChange={(e) => onChange({ ...audio, start: Number(e.target.value) })}
            aria-label="Audio start time"
            className="w-full accent-brand-orange"
          />
        </label>
      )}

      <p className="text-white/40 text-[11px] leading-snug">
        {shortAudio
          ? 'The audio ends before the clip does — the rest will be quiet. '
          : clipLength !== null
            ? `The audio is cut to your ${Math.round(clipLength * 10) / 10}s clip. `
            : ''}
        Turn Original sound Off to replace it.
        {canPreview ? ' Press play above to hear the mix.' : ' This format can’t be previewed here, but it will be added when you post.'}
      </p>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      {input}
    </div>
  );
}
