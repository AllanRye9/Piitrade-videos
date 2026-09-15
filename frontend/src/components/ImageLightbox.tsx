import { useState } from 'react';
import { mediaUrl } from '../config';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';

interface Props {
  images: string[];
  initialIndex: number;
  title: string;
  onClose: () => void;
}

/**
 * Full-screen viewer for a listing's photo(s), opened by tapping a
 * result's thumbnail in SearchResultsPanel. Shows every image the
 * listing has (not just the one thumbnail), with left/right
 * navigation when there's more than one, and tap-to-zoom on the
 * current image.
 */
export default function ImageLightbox({ images, initialIndex, title, onClose }: Props) {
  const [index, setIndex] = useState(Math.min(Math.max(initialIndex, 0), Math.max(images.length - 1, 0)));
  const [zoomed, setZoomed] = useState(false);

  if (images.length === 0) return null;

  function go(delta: number) {
    setZoomed(false);
    setIndex((i) => (i + delta + images.length) % images.length);
  }

  return (
    <div className="fixed inset-0 z-[58] bg-black flex flex-col">
      <div className="safe-top flex items-center justify-between px-4 py-3 text-white">
        <span className="text-xs text-white/60 truncate pr-2">
          {title}
          {images.length > 1 && ` — ${index + 1}/${images.length}`}
        </span>
        <div className="flex items-center gap-3 shrink-0">
          <button type="button" onClick={() => setZoomed((z) => !z)} aria-label={zoomed ? 'Zoom out' : 'Zoom in'} className="tap-target">
            {zoomed ? <ZoomOut size={20} /> : <ZoomIn size={20} />}
          </button>
          <button type="button" onClick={onClose} aria-label="Close image viewer" className="tap-target">
            <X size={22} />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden flex items-center justify-center">
        <img
          src={mediaUrl(images[index])}
          alt={`${title} — photo ${index + 1}`}
          onClick={() => setZoomed((z) => !z)}
          className={`max-w-full max-h-full object-contain transition-transform duration-200 cursor-zoom-in ${
            zoomed ? 'scale-[2.2] cursor-zoom-out' : ''
          }`}
        />

        {images.length > 1 && !zoomed && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous image"
              className="tap-target absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 rounded-full p-2 text-white"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next image"
              className="tap-target absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 rounded-full p-2 text-white"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>

      {images.length > 1 && (
        <div className="safe-bottom flex items-center justify-center gap-1.5 py-3">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setZoomed(false);
                setIndex(i);
              }}
              aria-label={`Go to image ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/30'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
