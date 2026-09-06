import { useEffect, useRef, useState } from 'react';

interface Props {
  videoEl: HTMLVideoElement;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Lets the user drag a selection box over the current video frame and
 * returns a cropped JPEG blob of that region. Draws the frame to an
 * off-screen canvas at the video's native resolution, and a separate
 * on-screen canvas (scaled for devicePixelRatio, set up ONCE) for the
 * visible frame + selection box — the earlier bug in this app came from
 * resetting canvas.width a second time after the DPR scale was applied,
 * which silently un-scaled everything on Retina/high-DPI screens. Here
 * the sizing happens exactly once.
 */
export default function CropOverlay({ videoEl, onCancel, onCropped }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dispSize = useRef({ w: 0, h: 0 });

  // Capture the current frame once when the overlay opens.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = canvas?.parentElement;
    if (!canvas || !wrapper) return;

    const rectBox = wrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Set the on-screen canvas's pixel size ONCE, scaled for DPR.
    canvas.width = rectBox.width * dpr;
    canvas.height = rectBox.height * dpr;
    canvas.style.width = `${rectBox.width}px`;
    canvas.style.height = `${rectBox.height}px`;
    dispSize.current = { w: rectBox.width, h: rectBox.height };

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    try {
      const vidW = videoEl.videoWidth;
      const vidH = videoEl.videoHeight;
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = vidW;
      frameCanvas.height = vidH;
      const fctx = frameCanvas.getContext('2d');
      if (!fctx) throw new Error('Canvas context unavailable');
      fctx.drawImage(videoEl, 0, 0, vidW, vidH);
      // Trigger a read to force any tainted-canvas security error now,
      // rather than later when the user finishes dragging a selection.
      fctx.getImageData(0, 0, 1, 1);
      frameCanvasRef.current = frameCanvas;

      drawFrame(ctx, frameCanvas, rectBox.width, rectBox.height);
    } catch (err) {
      console.warn('Visual search: could not capture video frame', err);
      setError('Visual search is unavailable for this video (its source does not allow frame capture in this browser).');
    }
  }, [videoEl]);

  function drawFrame(ctx: CanvasRenderingContext2D, frame: HTMLCanvasElement, dispW: number, dispH: number, sel?: Rect) {
    ctx.clearRect(0, 0, dispW, dispH);
    ctx.drawImage(frame, 0, 0, dispW, dispH);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, dispW, dispH);
    if (sel) {
      ctx.clearRect(sel.x, sel.y, sel.w, sel.h);
      ctx.drawImage(
        frame,
        (sel.x / dispW) * frame.width,
        (sel.y / dispH) * frame.height,
        (sel.w / dispW) * frame.width,
        (sel.h / dispH) * frame.height,
        sel.x,
        sel.y,
        sel.w,
        sel.h
      );
      ctx.strokeStyle = '#25f4ee';
      ctx.lineWidth = 2;
      ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
    }
  }

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const box = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(dispSize.current.w, e.clientX - box.left)),
      y: Math.max(0, Math.min(dispSize.current.h, e.clientY - box.top)),
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (error) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragStart.current = pointerPos(e);
    setRect(null);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragStart.current || error) return;
    const pos = pointerPos(e);
    const start = dragStart.current;
    const newRect: Rect = {
      x: Math.min(start.x, pos.x),
      y: Math.min(start.y, pos.y),
      w: Math.abs(pos.x - start.x),
      h: Math.abs(pos.y - start.y),
    };
    setRect(newRect);

    const ctx = canvasRef.current?.getContext('2d');
    const frame = frameCanvasRef.current;
    if (ctx && frame) drawFrame(ctx, frame, dispSize.current.w, dispSize.current.h, newRect);
  }

  function handlePointerUp() {
    dragStart.current = null;
  }

  function confirmSelection() {
    const frame = frameCanvasRef.current;
    if (!frame || !rect || rect.w < 6 || rect.h < 6) return;

    const cropCanvas = document.createElement('canvas');
    const sx = (rect.x / dispSize.current.w) * frame.width;
    const sy = (rect.y / dispSize.current.h) * frame.height;
    const sw = (rect.w / dispSize.current.w) * frame.width;
    const sh = (rect.h / dispSize.current.h) * frame.height;
    cropCanvas.width = sw;
    cropCanvas.height = sh;
    const ctx = cropCanvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, sw, sh);

    cropCanvas.toBlob(
      (blob) => {
        if (blob) onCropped(blob);
        else setError('Could not process the selected region.');
      },
      'image/jpeg',
      0.9
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <button onClick={onCancel} className="text-sm font-medium">
          Cancel
        </button>
        <span className="text-sm text-white/70">Drag to select an item</span>
        <button
          onClick={confirmSelection}
          disabled={!rect || rect.w < 6 || rect.h < 6 || !!error}
          className="text-sm font-semibold text-brand-cyan disabled:text-white/30"
        >
          Search
        </button>
      </div>
      <div className="relative flex-1 mx-4 mb-6 rounded-xl overflow-hidden bg-black">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-white/90 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
