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

  function isMp4(f: File): boolean {
    const nameIsMp4 = /\.mp4$/i.test(f.name);
    // Some OS/browser combos report an empty mimetype for local files —
    // in that case fall back to the extension alone. If a mimetype IS
    // reported, it must actually say mp4.
    const typeIsMp4 = f.type === '' ? true : f.type === 'video/mp4';
    return nameIsMp4 && typeIsMp4;
  }

  function rejectFile(message: string, url: string | null) {
    if (url) URL.revokeObjectURL(url);
    setFile(null);
    setPreviewUrl(null);
    setError(message);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleFile(f: File | null) {
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (!f) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (!isMp4(f)) {
      rejectFile('Only .mp4 files are supported.', null);
      return;
    }

    // Check the clip's length before doing anything else with it. Using
    // preload="metadata" on a throwaway <video> reads just the file's
    // header/duration — for a local file this is effectively instant
    // and never fetches or decodes the actual video frames, so an
    // oversized or invalid clip is rejected without any wasted work
    // (no preview render, no upload attempt).
    const url = URL.createObjectURL(f);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      const duration = probe.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        rejectFile('Could not read this video — please choose a different .mp4 file.', url);
        return;
      }
      if (duration > MAX_DURATION_SECONDS) {
        rejectFile(`Videos must be ${MAX_DURATION_SECONDS} seconds or less (this one is ${Math.round(duration)}s).`, url);
        return;
      }
      setChecking(false);
      setFile(f);
      setPreviewUrl(url);
      if (!title) setTitle(f.name.replace(/\.[^/.]+$/, ''));
    };
    probe.onerror = () => {
      rejectFile('Could not read this video — please choose a different .mp4 file.', url);
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

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/70">
      <div className="safe-bottom safe-left safe-right modal-max-h-90 w-full sm:max-w-md bg-neutral-900 rounded-t-2xl sm:rounded-2xl overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-white font-semibold text-sm">Upload video</span>
          <button type="button" onClick={onClose} aria-label="Close upload dialog" className="tap-target -mr-2 text-white/60">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {!previewUrl ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={checking}
              className="w-full aspect-video rounded-xl border-2 border-dashed border-white/20 flex flex-col items-center justify-center text-white/60 text-sm gap-2 disabled:opacity-60"
            >
              <Plus size={28} />
              {checking ? 'Checking video…' : 'Choose a .mp4 file'}
              <span className="text-white/40 text-xs">MP4 only · up to {MAX_DURATION_SECONDS}s</span>
            </button>
          ) : (
            <video src={previewUrl} controls className="w-full aspect-video rounded-xl bg-black" />
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,video/mp4"
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
