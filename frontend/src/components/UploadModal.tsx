import { useRef, useState } from 'react';
import { api } from '../api';
import type { Video } from '../types';

interface Props {
  onClose: () => void;
  onUploaded: (video: Video) => void;
}

export default function UploadModal({ onClose, onUploaded }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function handleFile(f: File | null) {
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (!f) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (!f.type.startsWith('video/')) {
      setError('Please choose a video file.');
      return;
    }
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    if (!title) setTitle(f.name.replace(/\.[^/.]+$/, ''));
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
      <div className="safe-bottom safe-left safe-right w-full sm:max-w-md bg-neutral-900 rounded-t-2xl sm:rounded-2xl max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-white font-semibold text-sm">Upload video</span>
          <button onClick={onClose} className="tap-target -mr-2 text-white/60 text-sm">
            Close
          </button>
        </div>

        <div className="p-4 space-y-4">
          {!previewUrl ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full aspect-video rounded-xl border-2 border-dashed border-white/20 flex flex-col items-center justify-center text-white/60 text-sm gap-2"
            >
              <span className="text-3xl">＋</span>
              Choose a video file
            </button>
          ) : (
            <video src={previewUrl} controls className="w-full aspect-video rounded-xl bg-black" />
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
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
              onClick={submit}
              disabled={!file}
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
