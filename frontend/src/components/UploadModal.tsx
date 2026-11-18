import { useEffect, useRef, useState } from 'react';
import type { TrimRange } from '../api';
import { isUploadBusy, startUpload } from '../uploadManager';
import { useAudioSync } from '../useAudioSync';
import type { AudioPreview } from '../useAudioSync';
import { MAX_VIDEO_SECONDS } from '../config';
import { useSites } from '../sites';
import { ProductDraft, draftsToPayload } from '../productDrafts';
import ProductListEditor from './ProductListEditor';
import VideoTrimmer from './VideoTrimmer';
import AudioPanel from './AudioPanel';
import type { AudioSelection } from './AudioPanel';
import { X, Plus, Scissors, UploadCloud } from 'lucide-react';

interface Props {
  onClose: () => void;
}

// Matches the tolerance the backend applies (lib/videoLimits.ts) so a
// clip the server would accept is never sent to the trim editor.
const LIMIT_EPSILON = 0.05;

const SUPPORTED_EXTENSIONS = ['.mp4', '.mov', '.webm', '.m4v', '.3gp', '.avi', '.mkv', '.wmv', '.flv'];

const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.opus', '.flac', '.weba'];
const MAX_AUDIO_MB = 50;

function hasSupportedAudioExtension(f: File): boolean {
  const lower = f.name.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** The plain preview for a video that's already within the limit (no trim
 *  needed) — with any added audio playing along, so the mix can be heard. */
function PlainPreview({ src, audio }: { src: string; audio: AudioPreview | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useAudioSync(ref, audio, 0, false);
  return <video ref={ref} src={src} controls playsInline className="w-full aspect-video rounded-xl bg-black" />;
}

function hasSupportedExtension(f: File): boolean {
  const lower = f.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export default function UploadModal({ onClose }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const sites = useSites();
  const [productDrafts, setProductDrafts] = useState<ProductDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Set once we know the source is longer than MAX_VIDEO_SECONDS —
  // either measured in the browser, or reported by the server for
  // formats a browser can't read. While set, the trim editor is shown
  // and `trim` is what gets posted.
  const [sourceDuration, setSourceDuration] = useState<number | null>(null);
  const [trim, setTrim] = useState<TrimRange | null>(null);
  // Length of the chosen video as the browser reads it (null if it can't).
  const [probedDuration, setProbedDuration] = useState<number | null>(null);

  // Audio added to the video, if any.
  const [audio, setAudio] = useState<AudioSelection | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  const needsTrim = trim !== null && sourceDuration !== null;
  const trimLength = trim ? trim.end - trim.start : 0;
  const trimValid = !needsTrim || (trimLength >= 1 - LIMIT_EPSILON && trimLength <= MAX_VIDEO_SECONDS + LIMIT_EPSILON);

  function dropAudio() {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    setAudio(null);
    setAudioError(null);
  }

  function handleAudioPick(f: File) {
    setAudioError(null);
    if (!hasSupportedAudioExtension(f)) {
      setAudioError('Unsupported audio format. Supported: MP3, M4A, AAC, WAV, OGG, Opus, FLAC.');
      return;
    }
    if (f.size > MAX_AUDIO_MB * 1024 * 1024) {
      setAudioError(`That audio file is too large (max ${MAX_AUDIO_MB}MB).`);
      return;
    }
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const url = URL.createObjectURL(f);
    audioUrlRef.current = url;
    const base: AudioSelection = { file: f, url, duration: null, videoVolume: 1, audioVolume: 0.7, start: 0 };
    setAudio(base);

    // Read the length from the header, like the video probe does. If the
    // browser can't decode this format there is simply no preview and no
    // start slider — the server still reads and mixes it.
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      if (audioUrlRef.current !== url) return;
      setAudio((cur) => (cur && cur.url === url ? { ...cur, duration: Number.isFinite(probe.duration) ? probe.duration : null } : cur));
    };
    probe.onerror = () => {
      if (audioUrlRef.current !== url) return;
      setAudio((cur) => (cur && cur.url === url ? { ...cur, url: null } : cur));
    };
    probe.src = url;
  }

  function resetTrim() {
    setSourceDuration(null);
    setTrim(null);
  }

  function requireTrim(duration: number) {
    setSourceDuration(duration);
    // Start with the first 60 seconds selected; the uploader adjusts from there.
    setTrim({ start: 0, end: Math.min(duration, MAX_VIDEO_SECONDS) });
  }

  function rejectFile(message: string, url: string | null) {
    if (url) URL.revokeObjectURL(url);
    setFile(null);
    setPreviewUrl(null);
    resetTrim();
    setError(message);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function acceptFile(f: File, url: string | null) {
    setChecking(false);
    setFile(f);
    setPreviewUrl(url);
    if (!title) setTitle(f.name.replace(/\.[^/.]+$/, ''));
  }

  function handleFile(f: File | null) {
    setError(null);
    resetTrim();
    setProbedDuration(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (!f) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (!hasSupportedExtension(f)) {
      rejectFile('Unsupported format. Supported: MP4, MOV, WebM, M4V, 3GP, AVI, MKV, WMV, FLV.', null);
      return;
    }

    // Check the clip's length before uploading, using preload="metadata"
    // on a throwaway <video> — effectively instant for a local file
    // since it only reads the header, not the actual frames.
    //
    // A clip longer than MAX_VIDEO_SECONDS is NOT rejected: it opens
    // the trim editor so the uploader can pick up to 60 seconds of it.
    //
    // This only works for formats the BROWSER can decode (MP4/MOV/WebM
    // in most browsers; M4V/3GP inconsistently; AVI/MKV/WMV/FLV
    // essentially never). The server accepts and measures all of the
    // formats above regardless (via ffprobe) — so when the browser
    // can't read this file's metadata, it's accepted without a local
    // preview, and if the server then finds it too long it replies
    // with VIDEO_TOO_LONG and its real duration, which opens the trim
    // editor in its no-preview mode (see submit()).
    const url = URL.createObjectURL(f);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      const duration = probe.duration;
      if (Number.isFinite(duration)) setProbedDuration(duration);
      if (Number.isFinite(duration) && duration > MAX_VIDEO_SECONDS + LIMIT_EPSILON) {
        requireTrim(duration);
      }
      acceptFile(f, url);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      acceptFile(f, null);
    };
    setChecking(true);
    probe.src = url;
  }

  function submit() {
    if (!file) {
      setError('Choose a video first.');
      return;
    }
    if (!trimValid) {
      setError(`Choose a section between 1 and ${MAX_VIDEO_SECONDS} seconds.`);
      return;
    }
    if (isUploadBusy()) {
      setError('Another video is still uploading — wait for it to finish.');
      return;
    }
    let products;
    try {
      products = draftsToPayload(productDrafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check the product details.');
      return;
    }
    setError(null);
    // Hand the file to the background upload manager and get out of the
    // way: progress shows in the floating <UploadStatus /> card.
    startUpload({
      file,
      title: title || 'Untitled',
      description,
      link: products.length ? { products } : null,
      trim: needsTrim ? trim : null,
      audio: audio
        ? {
            file: audio.file,
            videoVolume: audio.videoVolume,
            audioVolume: audio.audioVolume,
            // never ask to start past the end of a track we could measure
            audioStart: audio.duration !== null ? Math.min(audio.start, Math.max(0, audio.duration - 1)) : audio.start,
          }
        : null,
    });
    onClose();
  }

  // Dropping a file works over the whole modal, not just the dropzone
  // box, so the user doesn't have to aim precisely. onDragOver must
  // call preventDefault() too — without it the browser's default drop
  // behavior (opening the file in a new tab/navigating away) wins and
  // the onDrop handler never fires at all.
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!checking) setIsDraggingOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Only clear the highlight once the pointer actually leaves the
    // modal (not just moving between two child elements inside it,
    // which also fires dragleave/dragenter pairs).
    if (e.currentTarget === e.target || !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setIsDraggingOver(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (checking) return;
    const dropped = e.dataTransfer.files?.[0] || null;
    if (dropped) handleFile(dropped);
  }

  const uploading = false; // uploads run in the background once Post is tapped
  const clipLength = needsTrim ? trimLength : probedDuration;
  const audioPreview: AudioPreview | null = audio
    ? { url: audio.url, start: audio.start, videoVolume: audio.videoVolume, audioVolume: audio.audioVolume }
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/70 backdrop-blur-sm">
      <div
        className="animate-sheet-in safe-bottom safe-left safe-right modal-max-h-90 w-full sm:max-w-md bg-neutral-900 rounded-t-2xl sm:rounded-2xl overflow-y-auto"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-white font-semibold text-sm">{needsTrim ? 'Trim your video' : file ? 'Edit your video' : 'Upload video'}</span>
          <button type="button" onClick={onClose} aria-label="Close upload dialog" className="tap-target -mr-2 text-white/60">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {!file ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={checking}
              className={`w-full aspect-video rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-sm gap-2 disabled:opacity-60 transition-colors ${
                isDraggingOver ? 'border-brand-orange bg-brand-orange/10 text-white' : 'border-white/20 text-white/60'
              }`}
            >
              <Plus size={28} />
              {checking ? 'Checking video…' : isDraggingOver ? 'Drop to upload' : 'Choose or drop a video file'}
              <span className="text-white/40 text-xs">
                MP4, MOV, WebM &amp; more · up to {MAX_VIDEO_SECONDS}s — longer videos can be trimmed, and you can add your own audio
              </span>
            </button>
          ) : needsTrim && trim && sourceDuration !== null ? (
            <>
              <div className="flex items-start gap-2 rounded-lg bg-brand-orange/10 border border-brand-orange/30 px-3 py-2">
                <Scissors size={16} className="text-brand-orange shrink-0 mt-0.5" />
                <p className="text-white/80 text-xs">
                  Videos on Piitrade can be up to {MAX_VIDEO_SECONDS} seconds. Yours is {Math.round(sourceDuration)}s —
                  choose the part to post.
                </p>
              </div>
              <VideoTrimmer
                previewUrl={previewUrl}
                duration={sourceDuration}
                maxSeconds={MAX_VIDEO_SECONDS}
                value={trim}
                onChange={setTrim}
                audio={audioPreview}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="text-white/50 underline text-xs disabled:opacity-40"
              >
                Choose a different file
              </button>
            </>
          ) : previewUrl ? (
            <PlainPreview src={previewUrl} audio={audioPreview} />
          ) : (
            // Chosen, but this browser can't decode it well enough to
            // preview locally (see handleFile's probe.onerror) — the
            // file is still valid and will be measured/converted
            // server-side on upload.
            <div className="w-full aspect-video rounded-xl bg-neutral-800 flex flex-col items-center justify-center text-white/60 text-sm gap-2 px-4 text-center">
              <span className="font-medium text-white break-all">{file.name}</span>
              <span className="text-xs text-white/40">Preview isn't available for this format in-browser — it'll still upload fine.</span>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="text-brand-amber underline text-xs mt-1">
                Choose a different file
              </button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,.mov,.webm,.m4v,.3gp,.avi,.mkv,.wmv,.flv,video/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
          />

          {file && (
            <AudioPanel
              audio={audio}
              clipLength={clipLength}
              error={audioError}
              disabled={uploading}
              canPreview={Boolean(previewUrl) && audio?.url !== null}
              onPick={handleAudioPick}
              onChange={setAudio}
              onRemove={dropAudio}
            />
          )}

          <div className="space-y-1">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              maxLength={200}
              className="w-full rounded-xl bg-white/10 px-3 py-2.5 text-sm text-white outline-none ring-1 ring-transparent placeholder:text-white/40 focus:ring-brand-orange/60"
            />
            <p className="text-right text-[11px] text-white/30">{title.length}/200</p>
          </div>
          <div className="space-y-1">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (mention what you're selling or showing) — add #hashtags so people can find it"
              rows={3}
              maxLength={1000}
              className="w-full resize-none rounded-xl bg-white/10 px-3 py-2.5 text-sm text-white outline-none ring-1 ring-transparent placeholder:text-white/40 focus:ring-brand-orange/60"
            />
            <p className="text-right text-[11px] text-white/30">{description.length}/1000</p>
          </div>

          {/* Products shown on the video. Optional: viewers get tappable "Shop" buttons, and the creator earns when they lead to a sale. */}
          {sites.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-white/70">Products in this video (optional)</p>
              <ProductListEditor value={productDrafts} onChange={setProductDrafts} sites={sites} durationSec={needsTrim ? trim.end - trim.start : null} />
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
        </div>

        {/* Sticky footer: the primary action is always reachable, even when
            the trimmer and audio panel make the dialog scroll. */}
        <div className="sticky bottom-0 border-t border-white/10 bg-neutral-900/95 px-4 py-3 backdrop-blur">
          <button
            type="button"
            onClick={submit}
            disabled={!file || checking || !trimValid}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-orange to-brand-amber py-3 text-sm font-semibold text-white shadow-lg shadow-brand-orange/20 transition-opacity disabled:bg-none disabled:bg-white/10 disabled:text-white/40 disabled:shadow-none"
          >
            <UploadCloud size={18} />
            {needsTrim ? `Post ${Math.round(trimLength * 10) / 10}s clip` : 'Post video'}
          </button>
          <p className="mt-1.5 text-center text-[11px] text-white/40">You can keep browsing while it uploads.</p>
        </div>
      </div>
    </div>
  );
}
