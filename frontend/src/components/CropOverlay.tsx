import { useEffect, useRef, useState } from 'react';
import { Square, Circle, Lasso, RectangleHorizontal } from 'lucide-react';

interface Props {
  videoEl: HTMLVideoElement;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
}

type Tool = 'rect' | 'square' | 'circle' | 'freeform';

interface Point {
  x: number;
  y: number;
}

interface BoxShape {
  kind: 'rect' | 'square' | 'circle';
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FreeShape {
  kind: 'freeform';
  points: Point[];
}

type ShapeSel = BoxShape | FreeShape;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const TOOLS: Array<{ id: Tool; label: string; Icon: typeof Square }> = [
  { id: 'rect', label: 'Rectangle', Icon: RectangleHorizontal },
  { id: 'square', label: 'Square', Icon: Square },
  { id: 'circle', label: 'Circle', Icon: Circle },
  { id: 'freeform', label: 'Freeform', Icon: Lasso },
];

// The largest dimension (in native pixels) a cropped selection is
// allowed to be sent for search at. Selecting a small region of a
// high-resolution video would otherwise still send a huge, unnecessary
// payload — capping this keeps every search request a reasonable size
// regardless of source video resolution or how large a region was drawn.
const MAX_OUTPUT_DIMENSION = 1600;
const MIN_SELECTION_DISPLAY_PX = 6;

/**
 * Lets the user mark a region of the current (paused) video frame —
 * as a rectangle, square, circle, or freeform lasso — and returns a
 * cropped image blob of just that region for visual search.
 *
 * Sizing correctness: the video element renders with object-contain,
 * so unless the wrapper's aspect ratio exactly matches the video's,
 * there are letterbox bars on two sides. This overlay computes that
 * exact "contain" rect (`containRect`) and only ever draws the frame,
 * accepts pointer input, and maps selections back to native video
 * pixels within that rect — never the full canvas. The previous
 * version stretched the frame to fill the entire canvas regardless of
 * aspect ratio, so a selection near a letterbox edge would silently
 * map onto video pixels that don't correspond to what was visually
 * selected (an incorrect, effectively "oversized" crop). Output is
 * also capped to MAX_OUTPUT_DIMENSION so payload size never balloons
 * for a large selection or a high-resolution source video.
 */
export default function CropOverlay({ videoEl, onCancel, onCropped }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('rect');
  const [shape, setShape] = useState<ShapeSel | null>(null);
  const dragStart = useRef<Point | null>(null);
  const freeformPoints = useRef<Point[]>([]);
  const isDragging = useRef(false);
  const dispSize = useRef({ w: 0, h: 0 });
  const containRect = useRef<Rect>({ x: 0, y: 0, w: 0, h: 0 });

  // Capture the current frame and compute the letterbox-aware contain
  // rect once when the overlay opens.
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
      if (!vidW || !vidH) throw new Error('Video has no readable dimensions yet');

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

      containRect.current = computeContainRect(vidW, vidH, rectBox.width, rectBox.height);
      redraw(null);
    } catch (err) {
      console.warn('Visual search: could not capture video frame', err);
      setError('Visual search is unavailable for this video (its source does not allow frame capture in this browser).');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoEl]);

  function computeContainRect(vidW: number, vidH: number, boxW: number, boxH: number): Rect {
    const videoAspect = vidW / vidH;
    const boxAspect = boxW / boxH;
    if (videoAspect > boxAspect) {
      const w = boxW;
      const h = w / videoAspect;
      return { x: 0, y: (boxH - h) / 2, w, h };
    }
    const h = boxH;
    const w = h * videoAspect;
    return { x: (boxW - w) / 2, y: 0, w, h };
  }

  function tracePath(ctx: CanvasRenderingContext2D, s: ShapeSel) {
    ctx.beginPath();
    if (s.kind === 'freeform') {
      if (s.points.length === 0) return;
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.closePath();
    } else if (s.kind === 'circle') {
      const cx = s.x + s.w / 2;
      const cy = s.y + s.h / 2;
      ctx.ellipse(cx, cy, Math.max(s.w / 2, 0.01), Math.max(s.h / 2, 0.01), 0, 0, Math.PI * 2);
    } else {
      ctx.rect(s.x, s.y, s.w, s.h);
    }
  }

  function drawFrame(ctx: CanvasRenderingContext2D, frame: HTMLCanvasElement, cr: Rect, sel: ShapeSel | null) {
    const { w: dispW, h: dispH } = dispSize.current;
    ctx.clearRect(0, 0, dispW, dispH);
    ctx.drawImage(frame, cr.x, cr.y, cr.w, cr.h);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, dispW, dispH);
    if (sel) {
      ctx.save();
      tracePath(ctx, sel);
      ctx.clip();
      ctx.drawImage(frame, cr.x, cr.y, cr.w, cr.h);
      ctx.restore();

      ctx.save();
      tracePath(ctx, sel);
      ctx.strokeStyle = '#25f4ee';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  function redraw(sel: ShapeSel | null) {
    const ctx = canvasRef.current?.getContext('2d');
    const frame = frameCanvasRef.current;
    if (ctx && frame) drawFrame(ctx, frame, containRect.current, sel);
  }

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current!;
    const box = canvas.getBoundingClientRect();
    const cr = containRect.current;
    const rawX = e.clientX - box.left;
    const rawY = e.clientY - box.top;
    // Clamp to the actual video content area — never the full canvas —
    // so a drag that strays into a letterbox bar can't produce a
    // selection outside the video's real pixels.
    return {
      x: Math.max(cr.x, Math.min(cr.x + cr.w, rawX)),
      y: Math.max(cr.y, Math.min(cr.y + cr.h, rawY)),
    };
  }

  function clampBox(box: BoxShape, cr: Rect): BoxShape {
    const x = Math.max(cr.x, box.x);
    const y = Math.max(cr.y, box.y);
    const w = Math.max(0, Math.min(box.w, cr.x + cr.w - x));
    const h = Math.max(0, Math.min(box.h, cr.y + cr.h - y));
    return { ...box, x, y, w, h };
  }

  function selectTool(t: Tool) {
    setTool(t);
    setShape(null);
    dragStart.current = null;
    freeformPoints.current = [];
    redraw(null);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (error) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const pos = pointerPos(e);
    isDragging.current = true;
    if (tool === 'freeform') {
      freeformPoints.current = [pos];
      setShape({ kind: 'freeform', points: [pos] });
    } else {
      dragStart.current = pos;
      setShape(null);
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDragging.current || error) return;
    const pos = pointerPos(e);

    if (tool === 'freeform') {
      const points = [...freeformPoints.current, pos];
      freeformPoints.current = points;
      const next: ShapeSel = { kind: 'freeform', points };
      setShape(next);
      redraw(next);
      return;
    }

    const start = dragStart.current;
    if (!start) return;
    let w = pos.x - start.x;
    let h = pos.y - start.y;
    if (tool === 'square') {
      const side = Math.max(Math.abs(w), Math.abs(h));
      w = side * (w < 0 ? -1 : 1);
      h = side * (h < 0 ? -1 : 1);
    }
    const box = clampBox(
      {
        kind: tool,
        x: Math.min(start.x, start.x + w),
        y: Math.min(start.y, start.y + h),
        w: Math.abs(w),
        h: Math.abs(h),
      },
      containRect.current
    );
    setShape(box);
    redraw(box);
  }

  function handlePointerUp() {
    isDragging.current = false;
    dragStart.current = null;
  }

  function boundingBox(s: ShapeSel): Rect {
    if (s.kind === 'freeform') {
      const xs = s.points.map((p) => p.x);
      const ys = s.points.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
    }
    return { x: s.x, y: s.y, w: s.w, h: s.h };
  }

  function hasValidSelection(s: ShapeSel | null): boolean {
    if (!s) return false;
    const box = boundingBox(s);
    if (box.w < MIN_SELECTION_DISPLAY_PX || box.h < MIN_SELECTION_DISPLAY_PX) return false;
    if (s.kind === 'freeform' && s.points.length < 3) return false;
    return true;
  }

  // Traces the shape's outline in the crop's own local pixel space
  // (0,0 at the top-left of the bounding box, scaled to native
  // resolution) — used to mask non-rectangular selections so only the
  // marked area is opaque in the output image.
  function traceLocalPath(ctx: CanvasRenderingContext2D, s: ShapeSel, box: Rect, scaleX: number, scaleY: number) {
    ctx.beginPath();
    if (s.kind === 'freeform') {
      if (s.points.length === 0) return;
      ctx.moveTo((s.points[0].x - box.x) * scaleX, (s.points[0].y - box.y) * scaleY);
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo((s.points[i].x - box.x) * scaleX, (s.points[i].y - box.y) * scaleY);
      }
      ctx.closePath();
    } else if (s.kind === 'circle') {
      const cx = (s.x + s.w / 2 - box.x) * scaleX;
      const cy = (s.y + s.h / 2 - box.y) * scaleY;
      ctx.ellipse(cx, cy, Math.max((s.w / 2) * scaleX, 0.01), Math.max((s.h / 2) * scaleY, 0.01), 0, 0, Math.PI * 2);
    } else {
      ctx.rect(0, 0, box.w * scaleX, box.h * scaleY);
    }
  }

  function confirmSelection() {
    const frame = frameCanvasRef.current;
    if (!frame || !shape || !hasValidSelection(shape)) return;

    const cr = containRect.current;
    if (cr.w <= 0 || cr.h <= 0) {
      setError('Could not process the selected region.');
      return;
    }

    const box = boundingBox(shape);
    const scaleX = frame.width / cr.w;
    const scaleY = frame.height / cr.h;
    const sx = (box.x - cr.x) * scaleX;
    const sy = (box.y - cr.y) * scaleY;
    const sw = box.w * scaleX;
    const sh = box.h * scaleY;

    const isBoxShape = shape.kind === 'rect' || shape.kind === 'square';

    const nativeCrop = document.createElement('canvas');
    nativeCrop.width = Math.max(1, Math.round(sw));
    nativeCrop.height = Math.max(1, Math.round(sh));
    const nctx = nativeCrop.getContext('2d');
    if (!nctx) {
      setError('Could not process the selected region.');
      return;
    }

    if (!isBoxShape) {
      // Mask out everything except the marked shape so the identified
      // region matches exactly what the user drew, not its bounding box.
      nctx.save();
      traceLocalPath(nctx, shape, box, scaleX, scaleY);
      nctx.clip();
      nctx.drawImage(frame, sx, sy, sw, sh, 0, 0, nativeCrop.width, nativeCrop.height);
      nctx.restore();
    } else {
      nctx.drawImage(frame, sx, sy, sw, sh, 0, 0, nativeCrop.width, nativeCrop.height);
    }

    // Cap the output's largest dimension so payload size stays
    // reasonable no matter how large the selection or source video was.
    let outputCanvas: HTMLCanvasElement = nativeCrop;
    const largestDim = Math.max(nativeCrop.width, nativeCrop.height);
    if (largestDim > MAX_OUTPUT_DIMENSION) {
      const scale = MAX_OUTPUT_DIMENSION / largestDim;
      const resized = document.createElement('canvas');
      resized.width = Math.max(1, Math.round(nativeCrop.width * scale));
      resized.height = Math.max(1, Math.round(nativeCrop.height * scale));
      const rctx = resized.getContext('2d');
      if (rctx) {
        rctx.drawImage(nativeCrop, 0, 0, resized.width, resized.height);
        outputCanvas = resized;
      }
    }

    // Rectangular selections have no transparency to preserve, so JPEG
    // (smaller payload) is used; non-rectangular shapes need PNG to
    // keep the masked-out area transparent.
    outputCanvas.toBlob(
      (blob) => {
        if (blob) onCropped(blob);
        else setError('Could not process the selected region.');
      },
      isBoxShape ? 'image/jpeg' : 'image/png',
      0.9
    );
  }

  const canSearch = hasValidSelection(shape) && !error;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
      <div className="safe-top flex items-center justify-between px-2 sm:px-4 py-3 text-white">
        <button type="button" onClick={onCancel} className="tap-target px-2 text-sm font-medium">
          Cancel
        </button>
        <span className="text-xs sm:text-sm text-white/70 text-center px-2">Mark the item to search</span>
        <button
          type="button"
          onClick={confirmSelection}
          disabled={!canSearch}
          className="tap-target px-2 text-sm font-semibold text-brand-cyan disabled:text-white/30"
        >
          Search
        </button>
      </div>

      <div className="flex items-center justify-center gap-2 pb-2">
        {TOOLS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => selectTool(id)}
            aria-label={label}
            aria-pressed={tool === id}
            className={`tap-target flex flex-col items-center justify-center rounded-lg px-3 py-1.5 text-xs gap-1 ${
              tool === id ? 'bg-brand-cyan text-black' : 'bg-white/10 text-white/70'
            }`}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </div>

      <div className="safe-bottom safe-left safe-right relative flex-1 mx-3 sm:mx-4 mb-4 sm:mb-6 rounded-xl overflow-hidden bg-black">
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
