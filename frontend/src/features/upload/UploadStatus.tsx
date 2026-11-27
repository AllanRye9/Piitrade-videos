import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Loader2, UploadCloud, X } from 'lucide-react';
import { dismissUpload, retryUpload, useUploadState } from './uploadManager';

interface Props {
  /** Reopens the upload dialog (used when the video needs trimming). */
  onUploadAgain: () => void;
}

/**
 * Floating upload status. Appears when an upload starts (the dialog has
 * already closed), animates through uploading → processing → done, and
 * never blocks the feed underneath.
 */
export default function UploadStatus({ onUploadAgain }: Props) {
  const s = useUploadState();

  // A finished upload says its piece, then gets out of the way.
  useEffect(() => {
    if (s.phase !== 'done') return;
    const t = setTimeout(dismissUpload, 5000);
    return () => clearTimeout(t);
  }, [s.phase]);

  if (s.phase === 'idle') return null;

  const busy = s.phase === 'uploading' || s.phase === 'processing';
  const label =
    s.phase === 'uploading' ? `Uploading… ${s.progress}%` : s.phase === 'processing' ? 'Processing your video…' : s.phase === 'done' ? 'Posted!' : 'Upload failed';

  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-status-in safe-top fixed left-1/2 top-3 z-[60] w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/95 shadow-2xl shadow-black/50 backdrop-blur"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10">
          {s.phase === 'uploading' && <UploadCloud size={18} className="text-brand-amber animate-pulse" />}
          {s.phase === 'processing' && <Loader2 size={18} className="text-brand-amber animate-spin" />}
          {s.phase === 'done' && <CheckCircle2 size={20} className="animate-status-pop text-emerald-400" />}
          {s.phase === 'error' && <AlertCircle size={20} className="text-red-400" />}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{label}</p>
          <p className="truncate text-xs text-white/50">
            {s.phase === 'error' ? s.error : s.title || 'Untitled'}
          </p>
        </div>

        {s.phase === 'error' && (
          <button
            type="button"
            onClick={() => {
              if (s.tooLong) {
                dismissUpload();
                onUploadAgain();
              } else {
                retryUpload();
              }
            }}
            className="shrink-0 rounded-full bg-brand-orange px-3 py-1.5 text-xs font-semibold text-white"
          >
            {s.tooLong ? 'Choose clip' : 'Retry'}
          </button>
        )}
        {!busy && (
          <button type="button" onClick={dismissUpload} aria-label="Dismiss" className="shrink-0 text-white/50">
            <X size={18} />
          </button>
        )}
      </div>

      {busy && (
        <div className="relative h-1.5 w-full overflow-hidden bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-brand-orange to-brand-amber transition-[width] duration-300 ease-out"
            style={{ width: `${s.phase === 'processing' ? 100 : s.progress}%` }}
          />
          {s.phase === 'processing' && <div className="animate-status-shimmer absolute inset-y-0 left-0 w-1/3 bg-white/40" />}
        </div>
      )}
    </div>
  );
}
