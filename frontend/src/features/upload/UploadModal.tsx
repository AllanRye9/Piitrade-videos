import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { TrimRange } from '../../lib/api';
import type { ProductPin, SiteInfo } from '../../lib/types';
import { isUploadBusy, startUpload } from './uploadManager';
import { useAudioSync } from './useAudioSync';
import type { AudioPreview } from './useAudioSync';
import { MAX_VIDEO_SECONDS } from '../../lib/config';
import { storedSize } from '../../lib/frameStandard';
import VideoTrimmer from './VideoTrimmer';
import VideoEditor from './VideoEditor';
import { buildEditsPayload, defaultEdit, describeEdit, isUnedited, outputSeconds } from './editModel';
import type { EditState, Range } from './editModel';
import AudioPanel from './AudioPanel';
import ProductsEditor from '../products/ProductsEditor';
import type { AudioSelection } from './AudioPanel';
import { X, Plus, Scissors, UploadCloud, ShoppingBag, ChevronDown, Wand2 } from 'lucide-react';

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
  // Frame size as the browser reads it — used to tell the uploader what it will be stored as, and for the editor's crop.
  const [probedSize, setProbedSize] = useState<{ width: number; height: number } | null>(null);

  // Video editor (cuts, speed, crop, look, text…). `shortWindow` is the trim window of a video that is within the
  // limit (a longer one uses `trim`). Without edits the upload sends plain trimStart/trimEnd exactly as before.
  const [edit, setEdit] = useState<EditState>(defaultEdit);
  const [shortWindow, setShortWindow] = useState<Range | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  // Shop products pinned to the video (optional). Sent with the upload and checked by the server
  // before any processing, so a bad link fails fast.
  const [pins, setPins] = useState<ProductPin[]>([]);
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [showProducts, setShowProducts] = useState(false);
  const [pinNote, setPinNote] = useState<string | null>(null);
  useEffect(() => {
    api.getSites().then((r) => setSites(r.sites)).catch(() => {});
  }, []);

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
  const sourceLength = sourceDuration ?? probedDuration;
  const clipWindow: Range | null = trim ?? shortWindow ?? (probedDuration ? { start: 0, end: probedDuration } : null);
  const editedByTools = !isUnedited(edit);
  const editedLength = clipWindow && editedByTools ? outputSeconds(clipWindow, edit) : null;
  const trimValid = editedLength !== null
    ? editedLength >= 1 - LIMIT_EPSILON && editedLength <= MAX_VIDEO_SECONDS + LIMIT_EPSILON
    : !needsTrim || (trimLength >= 1 - LIMIT_EPSILON && trimLength <= MAX_VIDEO_SECONDS + LIMIT_EPSILON);

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
    const base: AudioSelection = { file: f, url, duration: null, audioVolume: 0.7, start: 0 };
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
    setEdit(defaultEdit());
    setShortWindow(null);
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
    setProbedSize(null);
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
      if (probe.videoWidth > 0 && probe.videoHeight > 0) setProbedSize({ width: probe.videoWidth, height: probe.videoHeight });
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
    setError(null);
    // Hand the file to the background upload manager and get out of the
    // way: progress shows in the floating <UploadStatus /> card.
    // Edits go as one JSON field and replace the plain trim; without edits the trim window (if any) is sent as before.
    const edits = clipWindow && probedSize && editedByTools ? buildEditsPayload(clipWindow, edit, probedSize) : null;
    startUpload({
      file,
      title: title || 'Untitled',
      description,
      edits,
      trim: edits ? null : needsTrim ? trim : shortWindow,
      products: pins.length ? pins.map((p) => ({ url: p.url, title: p.title.trim(), startMs: p.startMs, endMs: p.endMs })) : undefined,
      audio: audio
        ? {
            file: audio.file,
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
  const clipLength = editedLength ?? (needsTrim ? trimLength : shortWindow ? shortWindow.end - shortWindow.start : probedDuration);

  // Pin times are measured on the clip as posted. If the trim changes so that a pin no longer fits,
  // fit it (or drop it if it would start after the end) rather than failing the upload later.
  useEffect(() => {
    if (!clipLength || clipLength <= 0) return;
    const maxMs = Math.round(clipLength * 1000);
    setPins((cur) => {
      const next = cur
        .filter((p) => p.startMs <= maxMs - 1000)
        .map((p) => (p.endMs !== null && p.endMs > maxMs ? { ...p, endMs: maxMs } : p));
      const changed = next.length !== cur.length || next.some((p, i) => p !== cur[i]);
      if (changed) setPinNote('Some pinned products were adjusted to fit your trimmed clip.');
      return changed ? next : cur;
    });
  }, [clipLength]);
  const audioPreview: AudioPreview | null = audio
    ? { url: audio.url, start: audio.start, audioVolume: audio.audioVolume }
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
          ) : needsTrim && trim && sourceDuration !== null && !editedByTools ? (
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
          {file && previewUrl && clipWindow && sourceLength !== null && probedSize && (
            <div className="rounded-xl border border-white/10 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setEditorOpen(true)} className="flex items-center gap-2 text-sm text-white">
                  <Wand2 size={16} className="text-brand-amber" />
                  {editedByTools ? 'Edit again' : 'Edit video'}
                  <span className="text-xs text-white/40">cut · speed · crop · colour · text</span>
                </button>
                {editedByTools && (
                  <button type="button" onClick={() => { setEdit(defaultEdit()); setShortWindow(null); }} className="ml-auto text-[11px] text-white/50 underline">Remove edits</button>
                )}
              </div>
              {editedByTools && <p className="mt-1.5 text-xs text-brand-amber">{describeEdit(clipWindow, edit)} · {Math.round((editedLength ?? 0) * 10) / 10}s</p>}
              {editedByTools && editedLength !== null && !trimValid && (
                <p role="alert" className="mt-1 text-xs text-red-300">The edited video must be between 1 and {MAX_VIDEO_SECONDS} seconds — open the editor to shorten it.</p>
              )}
              {storedSize(probedSize.width, probedSize.height).changed && (
                <p className="mt-1.5 text-[11px] text-white/40">
                  This video is {probedSize.width}×{probedSize.height}. It will be stored at {storedSize(probedSize.width, probedSize.height).width}×{storedSize(probedSize.width, probedSize.height).height} so it plays smoothly.
                </p>
              )}
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

          {file && (
            <div className="rounded-xl border border-white/10">
              <button
                type="button"
                onClick={() => setShowProducts((v) => !v)}
                aria-expanded={showProducts}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left"
              >
                <span className="flex items-center gap-2 text-sm text-white">
                  <ShoppingBag size={16} className="text-brand-amber" />
                  Shop products{pins.length ? ` (${pins.length})` : ''}
                  <span className="text-xs text-white/40">optional</span>
                </span>
                <ChevronDown size={16} className={`text-white/50 transition-transform ${showProducts ? 'rotate-180' : ''}`} />
              </button>
              {showProducts && (
                <div className="border-t border-white/10 p-3">
                  <ProductsEditor pins={pins} onChange={setPins} sites={sites} durationMs={clipLength ? Math.round(clipLength * 1000) : null} />
                  {pinNote && <p role="status" className="mt-2 text-xs text-brand-amber">{pinNote}</p>}
                  <p className="mt-2 text-[11px] text-white/40">AI suggestions are available after the video is posted: open More → Pin products.</p>
                </div>
              )}
            </div>
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
            {needsTrim || editedByTools || shortWindow ? `Post ${Math.round((clipLength ?? 0) * 10) / 10}s clip` : 'Post video'}
          </button>
          <p className="mt-1.5 text-center text-[11px] text-white/40">You can keep browsing while it uploads.</p>
        </div>
      </div>
      {editorOpen && previewUrl && clipWindow && sourceLength !== null && (
        <VideoEditor
          previewUrl={previewUrl}
          duration={sourceLength}
          maxSeconds={MAX_VIDEO_SECONDS}
          window={clipWindow}
          edit={edit}
          audio={audioPreview}
          onClose={() => setEditorOpen(false)}
          onApply={(w, e) => {
            if (needsTrim) setTrim(w);
            else setShortWindow(w);
            setEdit(e);
            setEditorOpen(false);
          }}
        />
      )}
    </div>
  );
}
