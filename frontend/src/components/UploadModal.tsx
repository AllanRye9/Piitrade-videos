import { useRef, useState } from 'react';
import { api } from '../api';
import type { Video } from '../types';
import { X, Plus } from 'lucide-react';

interface Props {
  onClose: () => void;
  onUploaded: (video: Video) => void;
}

const MAX_DURATION_SECONDS = 60;

export default function UploadModal({ onClose, onUploaded }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const SUPPORTED_EXTENSIONS = ['.mp4', '.mov', '.webm', '.m4v', '.3gp', '.avi', '.mkv', '.wmv', '.flv'];

  function hasSupportedExtension(f: File): boolean {
    const lower = f.name.toLowerCase();
    return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }

  function rejectFile(message: string, url: string | null) {
    if (url) URL.revokeObjectURL(url);
    setFile(null);
    setPreviewUrl(null);
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
    // This only works for formats the BROWSER can decode (MP4/MOV/WebM
    // in most browsers; M4V/3GP inconsistently; AVI/MKV/WMV/FLV
    // essentially never, in any browser's <video> tag). The server
    // accepts and validates all of the formats above regardless (via
    // ffprobe, which isn't limited to browser-supported codecs — see
    // backend/src/routes/videos.ts) — so when the browser can't read
    // this file's metadata, that's not treated as a rejection here,
    // just as "can't preview locally"; the real length check still
    // happens server-side on upload.
    const url = URL.createObjectURL(f);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      const duration = probe.duration;
      if (Number.isFinite(duration) && duration > 0 && duration > MAX_DURATION_SECONDS) {
        rejectFile(`Videos must be ${MAX_DURATION_SECONDS} seconds or less (this one is ${Math.round(duration)}s).`, url);
        return;
      }
      acceptFile(f, url);
    };
    probe.onerror = () => {
      // Couldn't read metadata locally — likely a format this browser
      // doesn't decode (e.g. .mkv/.avi/.wmv). Accept without a local
      // preview; the server will still enforce the length limit.
      URL.revokeObjectURL(url);
      acceptFile(f, null);
    };
    setChecking(true);
    probe.src = url;
  }

  async function submit() {
    if (!file) {
      setError('Choose a video first.');
      return;
    }
    setProgress(0);
    setError(null);
    try {
      const res = await api.uploadVideo(file, title || 'Untitled', description, setProgress);
      onUploaded(res.video);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setProgress(null);
    }
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

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/70">
      <div
        className="safe-bottom safe-left safe-right modal-max-h-90 w-full sm:max-w-md bg-neutral-900 rounded-t-2xl sm:rounded-2xl overflow-y-auto"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-white font-semibold text-sm">Upload video</span>
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
                isDraggingOver ? 'border-brand-pink bg-brand-pink/10 text-white' : 'border-white/20 text-white/60'
              }`}
            >
              <Plus size={28} />
              {checking ? 'Checking video…' : isDraggingOver ? 'Drop to upload' : 'Choose or drop a video file'}
              <span className="text-white/40 text-xs">MP4, MOV, WebM &amp; more · up to {MAX_DURATION_SECONDS}s</span>
            </button>
          ) : previewUrl ? (
            <video src={previewUrl} controls className="w-full aspect-video rounded-xl bg-black" />
          ) : (
            // Chosen, but this browser can't decode it well enough to
            // preview locally (see handleFile's probe.onerror) — the
            // file is still valid and will be checked/converted
            // server-side on upload.
            <div className="w-full aspect-video rounded-xl bg-neutral-800 flex flex-col items-center justify-center text-white/60 text-sm gap-2 px-4 text-center">
              <span className="font-medium text-white">{file.name}</span>
              <span className="text-xs text-white/40">Preview isn't available for this format in-browser — it'll still upload fine.</span>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="text-brand-cyan underline text-xs mt-1">
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

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            maxLength={200}
            className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/40"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            rows={3}
            maxLength={1000}
            className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/40 resize-none"
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}

          {progress !== null ? (
            <div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-brand-pink transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-white/50 text-xs mt-1">{progress < 100 ? `Uploading… ${progress}%` : 'Processing…'}</p>
            </div>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!file || checking}
              className="w-full bg-brand-pink disabled:bg-white/10 disabled:text-white/40 text-white font-semibold text-sm rounded-lg py-2.5"
            >
              Post
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
