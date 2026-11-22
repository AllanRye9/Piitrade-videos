import { useState } from 'react';
import { Bookmark, Download, Flag, X, ChevronLeft } from 'lucide-react';

type ReportReason = 'spam' | 'inappropriate' | 'copyright' | 'other';

interface Props {
  favorited: boolean;
  reported: boolean;
  reportBusy: boolean;
  onFavorite: () => void;
  onDownload: () => void;
  onReport: (reason: ReportReason) => void;
  onClose: () => void;
}

const REASONS: ReportReason[] = ['spam', 'inappropriate', 'copyright', 'other'];

/**
 * The less-used per-video actions (favorite, download, report) live
 * here instead of each being its own icon stacked on the video —
 * that stack was most of the clutter on the right edge. Opens only
 * when asked for, so the video itself stays clear.
 */
export default function VideoMoreSheet({ favorited, reported, reportBusy, onFavorite, onDownload, onReport, onClose }: Props) {
  const [view, setView] = useState<'menu' | 'report'>('menu');
  const row = 'flex items-center gap-3.5 w-full px-4 py-3 text-left hover:bg-white/5 disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/60" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-sheet-in safe-bottom safe-left safe-right w-full sm:max-w-sm bg-neutral-900 rounded-t-2xl sm:rounded-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          {view === 'report' ? (
            <button type="button" onClick={() => setView('menu')} className="flex items-center gap-1 text-white text-sm font-semibold">
              <ChevronLeft size={18} /> Report this video
            </button>
          ) : (
            <span className="text-white text-sm font-semibold">More</span>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className="tap-target -mr-2 text-white/60">
            <X size={20} />
          </button>
        </div>

        {view === 'menu' ? (
          <div className="py-1">
            <button
              type="button"
              onClick={() => {
                onFavorite();
                onClose();
              }}
              className={row}
            >
              <Bookmark size={20} className={favorited ? 'text-brand-amber' : 'text-white/60'} fill={favorited ? 'currentColor' : 'none'} />
              <span className="text-white text-sm">{favorited ? 'Remove from favorites' : 'Add to favorites'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onDownload();
                onClose();
              }}
              className={row}
            >
              <Download size={20} className="text-white/60" />
              <span>
                <span className="block text-white text-sm">Download</span>
                <span className="block text-white/40 text-xs">Saved with a piitrade.com watermark. You can also hold the video for 3 seconds.</span>
              </span>
            </button>
            <button type="button" onClick={() => setView('report')} disabled={reported} className={row}>
              <Flag size={20} className={reported ? 'text-brand-orange' : 'text-white/60'} fill={reported ? 'currentColor' : 'none'} />
              <span className="text-white text-sm">{reported ? 'Reported — thank you' : 'Report'}</span>
            </button>
          </div>
        ) : (
          <div className="py-1">
            {REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                disabled={reportBusy}
                onClick={() => {
                  onReport(reason);
                  onClose();
                }}
                className={`${row} text-white text-sm capitalize`}
              >
                {reason}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
