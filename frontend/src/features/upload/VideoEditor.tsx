import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Scissors, Gauge, Palette, Crop, Type, Volume2, Play, X, Plus, Trash2, RotateCw, RotateCcw, FlipHorizontal, FlipVertical, Check } from 'lucide-react';
import { useAudioSync } from './useAudioSync';
import type { AudioPreview } from './useAudioSync';
import {
  ASPECTS, EDIT_LIMITS, LOOKS, SPEEDS, TEXT_COLORS, cleanOverlayText, cropRectFor, defaultEdit, editedTimeAt, fitTextsToLength, layoutOverlay,
  lookCss, nextPlayable, outputSeconds, segmentsFor,
} from './editModel';
import type { EditState, PresetId, Range, TextItem } from './editModel';

interface Props {
  previewUrl: string;
  /** Length of the whole source video, in seconds. */
  duration: number;
  /** Longest clip that may be posted, in seconds (measured after cuts and speed). */
  maxSeconds: number;
  window: Range;
  edit: EditState;
  /** The uploader added their own sound: it replaces the video's, so the volume tool is off. */
  audio: AudioPreview | null;
  onApply: (window: Range, edit: EditState) => void;
  onClose: () => void;
}

type Tool = 'cut' | 'speed' | 'look' | 'frame' | 'text' | 'sound';
type Drag = { kind: 'window'; edge: 'start' | 'end' } | { kind: 'cut'; index: number; edge: 'start' | 'end' };

const TOOLS: Array<{ id: Tool; label: string; Icon: typeof Scissors }> = [
  { id: 'cut', label: 'Cut', Icon: Scissors },
  { id: 'speed', label: 'Speed', Icon: Gauge },
  { id: 'look', label: 'Look', Icon: Palette },
  { id: 'frame', label: 'Frame', Icon: Crop },
  { id: 'text', label: 'Text', Icon: Type },
  { id: 'sound', label: 'Sound', Icon: Volume2 },
];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
let nextId = 1;

/**
 * Full-screen video editor: cut parts out, change speed, adjust colour, rotate/flip/crop, add text and fades,
 * set the sound level — with a live preview drawn from the same settings the server will render.
 *
 * Nothing is re-encoded here. The editor only produces settings (editModel.ts → `edits` on the upload); the
 * server cuts and renders, which is what makes every accepted format work. The preview is an approximation of
 * the result (colour especially), good enough to choose by.
 */
export default function VideoEditor({ previewUrl, duration, maxSeconds, window: initialWindow, edit: initialEdit, audio, onApply, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [win, setWin] = useState<Range>(initialWindow);
  const [ed, setEd] = useState<EditState>(initialEdit);
  const [tool, setTool] = useState<Tool>('cut');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(initialWindow.start);
  const [textIndex, setTextIndex] = useState(0);
  const [broken, setBroken] = useState(false);
  const dragRef = useRef<Drag | null>(null);

  // The draw/playback loop reads the latest state without restarting.
  const live = useRef({ win, ed, playing });
  live.current = { win, ed, playing };

  const segments = useMemo(() => segmentsFor(win, ed.cuts), [win, ed.cuts]);
  const outLen = outputSeconds(win, ed);
  const tooLong = outLen > maxSeconds + 0.05;
  const tooShort = outLen < 1 - 0.05 || segments.length === 0;

  useAudioSync(videoRef, audio, win.start, false);

  const set = useCallback((patch: Partial<EditState>) => setEd((cur) => ({ ...cur, ...patch })), []);

  // Sound and speed apply straight to the media element.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = clamp(ed.speed, 0.25, 4);
    if (!audio) v.volume = clamp(ed.volume, 0, 1);
  }, [ed.speed, ed.volume, audio]);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (v && Number.isFinite(t)) v.currentTime = clamp(t, 0, Math.max(0, duration - 0.05));
  }, [duration]);

  useEffect(() => {
    seek(initialWindow.start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One loop: keep playback inside the kept sections, and paint the frame the way the server will frame it.
  useEffect(() => {
    let raf = 0;
    const paint = () => {
      const v = videoRef.current;
      const canvas = canvasRef.current;
      const { win: w, ed: e, playing: isPlaying } = live.current;
      if (v && canvas && v.videoWidth > 0 && v.readyState >= 2) {
        const segs = segmentsFor(w, e.cuts);
        if (isPlaying && !v.seeking && segs.length) {
          const t = v.currentTime;
          const n = nextPlayable(t, segs);
          if (Math.abs(n - t) > 0.05) v.currentTime = n;
        }
        const vw = v.videoWidth;
        const vh = v.videoHeight;
        const turned = e.rotate % 180 !== 0;
        const uw = turned ? vh : vw;
        const uh = turned ? vw : vh;
        const crop = cropRectFor(e.aspect, e.aspect === 'original' ? 1 : e.zoom, e.panX, e.panY, uw, uh);
        const cx = (crop ? crop.x : 0) * uw;
        const cy = (crop ? crop.y : 0) * uh;
        const cw = (crop ? crop.w : 1) * uw;
        const ch = (crop ? crop.h : 1) * uh;
        const scale = Math.min(1, 640 / Math.max(cw, ch));
        const W = Math.max(2, Math.round(cw * scale));
        const H = Math.max(2, Math.round(ch * scale));
        if (canvas.width !== W || canvas.height !== H) {
          canvas.width = W;
          canvas.height = H;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, W, H);
          // upright frame → crop window → canvas
          ctx.setTransform(scale, 0, 0, scale, -cx * scale, -cy * scale);
          ctx.translate(uw / 2, uh / 2);
          ctx.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1); // flip is applied after the rotation, as on the server
          ctx.rotate((e.rotate * Math.PI) / 180);
          ctx.drawImage(v, -vw / 2, -vh / 2, vw, vh);
          ctx.setTransform(1, 0, 0, 1, 0, 0);

          const out = editedTimeAt(clamp(v.currentTime, w.start, w.end), segs, e.speed);
          if (out !== null) {
            for (const t of e.texts) {
              if (!t.text.trim() || out < t.start || out > t.end) continue;
              const laid = layoutOverlay(cleanOverlayText(t.text), W, H, t.size);
              if (!laid.lines.length || !laid.lines[0]) continue;
              ctx.font = `bold ${laid.fontSize}px "DejaVu Sans", Arial, sans-serif`;
              const lineH = laid.fontSize * 1.2;
              const tw = Math.max(...laid.lines.map((l) => ctx.measureText(l).width));
              const th = lineH * laid.lines.length;
              const pad = Math.round(laid.fontSize * 0.3);
              const x = (W - tw) * t.x;
              const y = (H - th) * t.y;
              if (t.box) {
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.fillRect(x - pad, y - pad, tw + pad * 2, th + pad * 2);
              }
              ctx.fillStyle = t.color;
              ctx.textBaseline = 'top';
              laid.lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineH));
            }
            const total = outputSeconds(w, e);
            let dark = 0;
            if (e.fadeIn > 0 && out < e.fadeIn) dark = Math.max(dark, 1 - out / e.fadeIn);
            if (e.fadeOut > 0 && out > total - e.fadeOut) dark = Math.max(dark, 1 - (total - out) / e.fadeOut);
            if (dark > 0) {
              ctx.fillStyle = `rgba(0,0,0,${clamp(dark, 0, 1)})`;
              ctx.fillRect(0, 0, W, H);
            }
          }
        }
        if (isPlaying) setTime(v.currentTime);
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, []);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.currentTime = nextPlayable(v.currentTime, segments);
      v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      v.pause();
      setPlaying(false);
    }
  }

  // ---- timeline --------------------------------------------------------

  const timeAt = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return clamp(((clientX - r.left) / r.width) * duration, 0, duration);
  };

  function beginDrag(d: Drag, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = d;
    videoRef.current?.pause();
    setPlaying(false);
  }

  function onMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const t = r1(timeAt(e.clientX));
    const min = EDIT_LIMITS.minSegment;
    if (d.kind === 'window') {
      if (d.edge === 'start') setWin((w) => ({ start: clamp(t, 0, w.end - 1), end: w.end }));
      else setWin((w) => ({ start: w.start, end: clamp(t, w.start + 1, duration) }));
      seek(t);
    } else {
      setEd((cur) => ({
        ...cur,
        cuts: cur.cuts.map((c, i) => {
          if (i !== d.index) return c;
          return d.edge === 'start' ? { start: clamp(t, win.start, c.end - min), end: c.end } : { start: c.start, end: clamp(t, c.start + min, win.end) };
        }),
      }));
      seek(t);
    }
  }

  function addCut() {
    const t = clamp(videoRef.current?.currentTime ?? time, win.start, win.end);
    const end = Math.min(win.end, r1(t + 1));
    if (end - t < EDIT_LIMITS.minSegment || ed.cuts.length >= EDIT_LIMITS.maxCuts) return;
    set({ cuts: [...ed.cuts, { start: r1(t), end }] });
  }

  // ---- text ------------------------------------------------------------

  function addText() {
    if (ed.texts.length >= EDIT_LIMITS.maxTexts) return;
    const item: TextItem = { id: `t${nextId++}`, text: 'Your text', start: 0, end: Math.max(1, Math.min(outLen, 3)), x: 0.5, y: 0.8, size: 0.05, color: '#FFFFFF', box: true };
    set({ texts: [...ed.texts, item] });
    setTextIndex(ed.texts.length);
  }
  const patchText = (i: number, patch: Partial<TextItem>) => set({ texts: ed.texts.map((t, k) => (k === i ? { ...t, ...patch } : t)) });

  function apply() {
    if (tooLong || tooShort) return;
    onApply(win, { ...ed, texts: fitTextsToLength(ed.texts, outLen) });
  }

  const pct = (t: number) => `${(t / duration) * 100}%`;
  const texts = ed.texts;
  const cur = texts[clamp(textIndex, 0, Math.max(0, texts.length - 1))];
  const curIndex = texts.indexOf(cur);

  if (broken) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6">
        <div className="max-w-sm rounded-2xl bg-neutral-900 p-5 text-center text-sm text-white/80">
          <p>Your browser can’t play this video format, so it can’t be edited here.</p>
          <button type="button" onClick={onClose} className="mt-4 rounded-full bg-white/10 px-5 py-2 text-white">Close</button>
        </div>
      </div>
    );
  }

  return (
    <div role="dialog" aria-label="Edit video" className="fixed inset-0 z-[60] flex flex-col bg-neutral-950">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <button type="button" onClick={onClose} aria-label="Discard edits" className="tap-target text-white/70"><X size={20} /></button>
        <div className="text-center">
          <p className="text-white text-sm font-semibold">Edit video</p>
          <p className={`text-[11px] ${tooLong || tooShort ? 'text-red-400' : 'text-white/50'}`}>
            {tooShort ? 'Keep at least 1 second' : tooLong ? `${r1(outLen)}s — cut it to ${maxSeconds}s or less` : `${r1(outLen)}s of ${maxSeconds}s`}
          </p>
        </div>
        <button type="button" onClick={apply} disabled={tooLong || tooShort} aria-label="Apply edits" className="tap-target rounded-full bg-brand-orange px-3 text-white disabled:opacity-30">
          <Check size={18} />
        </button>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center bg-black">
        <video
          ref={videoRef}
          src={previewUrl}
          playsInline
          preload="auto"
          muted={false}
          onError={() => setBroken(true)}
          onPause={() => setPlaying(false)}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
        <canvas ref={canvasRef} style={{ filter: lookCss(ed) }} className="max-h-full max-w-full object-contain" aria-label="Preview" />
        <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause preview' : 'Play preview'} className="absolute inset-0 flex items-center justify-center">
          {!playing && <span className="w-14 h-14 rounded-full bg-black/50 flex items-center justify-center text-white"><Play size={26} fill="currentColor" strokeWidth={0} className="ml-0.5" /></span>}
        </button>
              </div>

      {/* timeline of the WHOLE source: lit = kept, red = cut out */}
      <div className="px-6 pt-3">
        <div
          ref={trackRef}
          className="relative h-12 rounded-lg bg-white/10 select-none touch-none"
          onPointerMove={onMove}
          onPointerUp={() => (dragRef.current = null)}
          onPointerCancel={() => (dragRef.current = null)}
          onPointerDown={(e) => { if (!dragRef.current) { const t = timeAt(e.clientX); seek(t); setTime(t); } }}
        >
          <div className="absolute inset-y-0 left-0 bg-black/60 rounded-l-lg pointer-events-none" style={{ width: pct(win.start) }} />
          <div className="absolute inset-y-0 right-0 bg-black/60 rounded-r-lg pointer-events-none" style={{ width: pct(duration - win.end) }} />
          <div className="absolute inset-y-0 border-y-2 border-brand-orange bg-brand-orange/15 pointer-events-none" style={{ left: pct(win.start), width: pct(win.end - win.start) }} />
          {ed.cuts.map((c, i) => (
            <div key={i} className="absolute inset-y-0 bg-red-500/55 border-x-2 border-red-300" style={{ left: pct(clamp(c.start, win.start, win.end)), width: pct(Math.max(0, Math.min(c.end, win.end) - Math.max(c.start, win.start))) }}>
              <div role="slider" aria-label={`Cut ${i + 1} start`} aria-valuenow={c.start} tabIndex={0} onPointerDown={(e) => beginDrag({ kind: 'cut', index: i, edge: 'start' }, e)} className="absolute -left-2 inset-y-0 w-4 cursor-ew-resize touch-none" />
              <div role="slider" aria-label={`Cut ${i + 1} end`} aria-valuenow={c.end} tabIndex={0} onPointerDown={(e) => beginDrag({ kind: 'cut', index: i, edge: 'end' }, e)} className="absolute -right-2 inset-y-0 w-4 cursor-ew-resize touch-none" />
            </div>
          ))}
          <div role="slider" aria-label="Clip start" aria-valuenow={win.start} tabIndex={0} onPointerDown={(e) => beginDrag({ kind: 'window', edge: 'start' }, e)} className="absolute -translate-x-full inset-y-0 w-5 flex justify-end cursor-ew-resize touch-none" style={{ left: pct(win.start) }}>
            <span className="h-full w-3 rounded-l-md bg-brand-orange flex items-center justify-center"><span className="w-0.5 h-5 rounded bg-white/90" /></span>
          </div>
          <div role="slider" aria-label="Clip end" aria-valuenow={win.end} tabIndex={0} onPointerDown={(e) => beginDrag({ kind: 'window', edge: 'end' }, e)} className="absolute inset-y-0 w-5 flex cursor-ew-resize touch-none" style={{ left: pct(win.end) }}>
            <span className="h-full w-3 rounded-r-md bg-brand-orange flex items-center justify-center"><span className="w-0.5 h-5 rounded bg-white/90" /></span>
          </div>
          <div className="absolute inset-y-0 w-0.5 bg-white pointer-events-none" style={{ left: pct(clamp(time, 0, duration)) }} />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-white/50"><span>{fmt(win.start)}</span><span>{fmt(time)}</span><span>{fmt(win.end)}</span></div>
      </div>

      {/* tool panel */}
      <div className="px-4 py-3 h-44 overflow-y-auto text-white text-sm">
        {tool === 'cut' && (
          <div className="space-y-2">
            <p className="text-white/60 text-xs">Drag the orange ends to trim. To remove a part from the middle, move to it and tap “Cut out here”, then drag the red edges.</p>
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={addCut} disabled={ed.cuts.length >= EDIT_LIMITS.maxCuts} className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs"><Scissors size={14} /> Cut out here</button>
              {ed.cuts.map((c, i) => (
                <span key={i} className="flex items-center gap-1 rounded-full bg-red-500/20 px-2.5 py-1 text-xs">
                  {fmt(c.start)}–{fmt(c.end)}
                  <button type="button" aria-label={`Remove cut ${i + 1}`} onClick={() => set({ cuts: ed.cuts.filter((_, k) => k !== i) })}><X size={12} /></button>
                </span>
              ))}
            </div>
          </div>
        )}

        {tool === 'speed' && (
          <div className="space-y-2">
            <div className="flex gap-2 flex-wrap">
              {SPEEDS.map((s) => (
                <button key={s} type="button" onClick={() => set({ speed: s })} aria-pressed={ed.speed === s} className={`rounded-full px-3 py-1.5 text-xs ${ed.speed === s ? 'bg-brand-orange text-white' : 'bg-white/10'}`}>{s}×</button>
              ))}
            </div>
            <p className="text-white/50 text-xs">Slow motion stretches the clip, fast forward shortens it — the {maxSeconds}-second limit is measured on the result.</p>
          </div>
        )}

        {tool === 'look' && (
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              {(Object.keys(LOOKS) as PresetId[]).map((id) => (
                <button key={id} type="button" onClick={() => set({ preset: id })} aria-pressed={ed.preset === id} className={`rounded-full px-3 py-1.5 text-xs ${ed.preset === id ? 'bg-brand-orange text-white' : 'bg-white/10'}`}>{LOOKS[id].label}</button>
              ))}
            </div>
            <Slider label="Brightness" min={-0.5} max={0.5} step={0.05} value={ed.brightness} onChange={(v) => set({ brightness: v })} />
            <Slider label="Contrast" min={0.5} max={1.5} step={0.05} value={ed.contrast} onChange={(v) => set({ contrast: v })} />
            <Slider label="Saturation" min={0} max={2} step={0.05} value={ed.saturation} onChange={(v) => set({ saturation: v })} />
          </div>
        )}

        {tool === 'frame' && (
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap items-center">
              {ASPECTS.map((a) => (
                <button key={a.id} type="button" onClick={() => set({ aspect: a.id, zoom: 1, panX: 0, panY: 0 })} aria-pressed={ed.aspect === a.id} className={`rounded-full px-3 py-1.5 text-xs ${ed.aspect === a.id ? 'bg-brand-orange text-white' : 'bg-white/10'}`}>{a.label}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <IconBtn label="Rotate left" onClick={() => set({ rotate: (((ed.rotate + 270) % 360) as EditState['rotate']) })}><RotateCcw size={16} /></IconBtn>
              <IconBtn label="Rotate right" onClick={() => set({ rotate: (((ed.rotate + 90) % 360) as EditState['rotate']) })}><RotateCw size={16} /></IconBtn>
              <IconBtn label="Flip horizontally" active={ed.flipH} onClick={() => set({ flipH: !ed.flipH })}><FlipHorizontal size={16} /></IconBtn>
              <IconBtn label="Flip vertically" active={ed.flipV} onClick={() => set({ flipV: !ed.flipV })}><FlipVertical size={16} /></IconBtn>
            </div>
            {ed.aspect !== 'original' && (
              <>
                <Slider label="Zoom" min={1} max={3} step={0.05} value={ed.zoom} onChange={(v) => set({ zoom: v })} />
                <Slider label="Move left / right" min={-1} max={1} step={0.05} value={ed.panX} onChange={(v) => set({ panX: v })} />
                <Slider label="Move up / down" min={-1} max={1} step={0.05} value={ed.panY} onChange={(v) => set({ panY: v })} />
              </>
            )}
          </div>
        )}

        {tool === 'text' && (
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap items-center">
              {texts.map((t, i) => (
                <button key={t.id} type="button" onClick={() => setTextIndex(i)} className={`max-w-[9rem] truncate rounded-full px-3 py-1.5 text-xs ${i === curIndex ? 'bg-brand-orange text-white' : 'bg-white/10'}`}>{t.text.trim() || 'Text'}</button>
              ))}
              <button type="button" onClick={addText} disabled={texts.length >= EDIT_LIMITS.maxTexts} className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs disabled:opacity-40"><Plus size={14} /> Add text</button>
            </div>
            {cur && (
              <div className="space-y-2">
                <input value={cur.text} maxLength={EDIT_LIMITS.maxTextChars} onChange={(e) => patchText(curIndex, { text: e.target.value })} aria-label="Text" className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm outline-none" />
                <p className="text-[11px] text-white/40">Emoji can’t be drawn on the video and are removed.</p>
                <Slider label={`Shows from ${r1(cur.start)}s`} min={0} max={Math.max(0.5, outLen - 0.2)} step={0.1} value={cur.start} onChange={(v) => patchText(curIndex, { start: v, end: Math.max(cur.end, v + 0.2) })} />
                <Slider label={`until ${r1(cur.end)}s`} min={0.2} max={Math.max(0.4, outLen)} step={0.1} value={cur.end} onChange={(v) => patchText(curIndex, { end: Math.max(v, cur.start + 0.2) })} />
                <div className="flex gap-2">
                  {([['Top', 0.1], ['Middle', 0.5], ['Bottom', 0.85]] as const).map(([l, y]) => (
                    <button key={l} type="button" onClick={() => patchText(curIndex, { y })} className="rounded-full bg-white/10 px-3 py-1 text-xs">{l}</button>
                  ))}
                </div>
                <Slider label="Left / right" min={0} max={1} step={0.05} value={cur.x} onChange={(v) => patchText(curIndex, { x: v })} />
                <Slider label="Size" min={0.03} max={0.1} step={0.005} value={cur.size} onChange={(v) => patchText(curIndex, { size: v })} />
                <div className="flex items-center gap-2">
                  {TEXT_COLORS.map((c) => (
                    <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => patchText(curIndex, { color: c })} style={{ background: c }} className={`h-6 w-6 rounded-full ring-2 ${cur.color === c ? 'ring-white' : 'ring-transparent'}`} />
                  ))}
                  <label className="ml-2 flex items-center gap-1 text-xs"><input type="checkbox" checked={cur.box} onChange={(e) => patchText(curIndex, { box: e.target.checked })} /> Background</label>
                  <button type="button" aria-label="Remove text" onClick={() => { set({ texts: texts.filter((_, k) => k !== curIndex) }); setTextIndex(0); }} className="ml-auto text-red-300"><Trash2 size={16} /></button>
                </div>
              </div>
            )}
          </div>
        )}

        {tool === 'sound' && (
          <div className="space-y-3">
            {audio ? (
              <p className="text-white/60 text-xs">You added your own audio, so it replaces this video’s sound. Fades below still apply to it.</p>
            ) : (
              <Slider label={ed.volume === 0 ? 'Original sound: muted' : `Original sound ${Math.round(ed.volume * 100)}%`} min={0} max={2} step={0.05} value={ed.volume} onChange={(v) => set({ volume: v })} />
            )}
            <Slider label={`Fade in ${ed.fadeIn}s`} min={0} max={EDIT_LIMITS.maxFade} step={0.5} value={ed.fadeIn} onChange={(v) => set({ fadeIn: v })} />
            <Slider label={`Fade out ${ed.fadeOut}s`} min={0} max={EDIT_LIMITS.maxFade} step={0.5} value={ed.fadeOut} onChange={(v) => set({ fadeOut: v })} />
          </div>
        )}
      </div>

      <nav className="flex border-t border-white/10 safe-bottom">
        {TOOLS.map(({ id, label, Icon }) => (
          <button key={id} type="button" onClick={() => setTool(id)} aria-pressed={tool === id} className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] ${tool === id ? 'text-brand-orange' : 'text-white/60'}`}>
            <Icon size={18} />
            {label}
          </button>
        ))}
        <button type="button" onClick={() => { setEd(defaultEdit()); setWin({ start: 0, end: Math.min(duration, maxSeconds) }); }} className="px-3 text-[11px] text-white/40 underline">Reset</button>
      </nav>
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-white/60">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} className="w-full accent-brand-orange" />
    </label>
  );
}

function IconBtn({ label, onClick, active = false, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} aria-pressed={active} onClick={onClick} className={`flex h-9 w-9 items-center justify-center rounded-full ${active ? 'bg-brand-orange text-white' : 'bg-white/10 text-white'}`}>
      {children}
    </button>
  );
}
