/**
 * The video editor's state and the rules that turn it into what the server
 * receives (`edits` on the upload — backend/src/lib/video/videoEdit.ts is the
 * authority and re-validates everything). Pure functions, no DOM, so they are
 * unit tested; the editor component only draws and calls these.
 *
 * Times: `cuts` and the trim window are in SOURCE seconds; text overlays are in
 * EDITED-clip seconds (what the viewer sees after cuts and speed).
 */

export interface Range {
  start: number;
  end: number;
}

export type AspectId = 'original' | '9:16' | '4:5' | '1:1' | '16:9';
export type PresetId = 'none' | 'vivid' | 'pop' | 'warm' | 'fade' | 'mono' | 'noir' | 'sepia';

export interface TextItem {
  id: string;
  text: string;
  start: number;
  end: number;
  x: number;
  y: number;
  size: number;
  color: string;
  box: boolean;
}

export interface EditState {
  /** Parts of the trim window to remove. */
  cuts: Range[];
  speed: number;
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  aspect: AspectId;
  zoom: number;
  /** Pan inside the crop, -1 (left/top) … 1 (right/bottom). */
  panX: number;
  panY: number;
  preset: PresetId;
  brightness: number;
  contrast: number;
  saturation: number;
  fadeIn: number;
  fadeOut: number;
  volume: number;
  texts: TextItem[];
}

export const EDIT_LIMITS = { minSpeed: 0.25, maxSpeed: 4, maxTexts: 5, maxTextChars: 80, maxFade: 3, minSegment: 0.3, maxCuts: 11 } as const;

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;
export const ASPECTS: Array<{ id: AspectId; label: string; ratio: number | null }> = [
  { id: 'original', label: 'Original', ratio: null },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

/** Mirrors LOOK_PRESETS on the server. */
export const LOOKS: Record<PresetId, { label: string; brightness: number; contrast: number; saturation: number; sepia: number }> = {
  none: { label: 'None', brightness: 0, contrast: 1, saturation: 1, sepia: 0 },
  vivid: { label: 'Vivid', brightness: 0, contrast: 1.1, saturation: 1.35, sepia: 0 },
  pop: { label: 'Pop', brightness: 0.01, contrast: 1.2, saturation: 1.2, sepia: 0 },
  warm: { label: 'Warm', brightness: 0.02, contrast: 1.05, saturation: 1.15, sepia: 0.25 },
  fade: { label: 'Fade', brightness: 0.06, contrast: 0.85, saturation: 0.8, sepia: 0 },
  mono: { label: 'Mono', brightness: 0, contrast: 1, saturation: 0, sepia: 0 },
  noir: { label: 'Noir', brightness: -0.05, contrast: 1.3, saturation: 0, sepia: 0 },
  sepia: { label: 'Sepia', brightness: 0, contrast: 1, saturation: 1, sepia: 1 },
};

export const TEXT_COLORS = ['#FFFFFF', '#FFD400', '#FF7A00', '#FF3B30', '#34C759', '#0A84FF'] as const;

export function defaultEdit(): EditState {
  return {
    cuts: [], speed: 1, rotate: 0, flipH: false, flipV: false, aspect: 'original', zoom: 1, panX: 0, panY: 0,
    preset: 'none', brightness: 0, contrast: 1, saturation: 1, fadeIn: 0, fadeOut: 0, volume: 1, texts: [],
  };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** True when nothing but (possibly) the plain trim window differs from the original. */
export function isUnedited(e: EditState): boolean {
  const d = defaultEdit();
  return (
    e.cuts.length === 0 && e.speed === d.speed && e.rotate === d.rotate && !e.flipH && !e.flipV && e.aspect === d.aspect &&
    e.preset === d.preset && e.brightness === d.brightness && e.contrast === d.contrast && e.saturation === d.saturation &&
    e.fadeIn === 0 && e.fadeOut === 0 && e.volume === 1 && e.texts.length === 0
  );
}

/** The kept sections: the trim window minus every cut, in order. Pieces shorter than the minimum are dropped. */
export function segmentsFor(window: Range, cuts: Range[]): Range[] {
  const sorted = cuts
    .map((c) => ({ start: clamp(c.start, window.start, window.end), end: clamp(c.end, window.start, window.end) }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  let cursor = window.start;
  for (const c of sorted) {
    if (c.start > cursor) out.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  if (window.end > cursor) out.push({ start: cursor, end: window.end });
  return out.filter((s) => s.end - s.start >= EDIT_LIMITS.minSegment - 1e-6).map((s) => ({ start: r3(s.start), end: r3(s.end) }));
}

/** Length of the edited clip in seconds. */
export function outputSeconds(window: Range, e: EditState): number {
  const kept = segmentsFor(window, e.cuts).reduce((sum, s) => sum + (s.end - s.start), 0);
  return r3(kept / e.speed);
}

/** Where a moment of the SOURCE falls on the edited clip's timeline (null when that moment is cut out). */
export function editedTimeAt(sourceTime: number, segments: Range[], speed: number): number | null {
  let before = 0;
  for (const s of segments) {
    if (sourceTime >= s.start && sourceTime <= s.end) return r3((before + (sourceTime - s.start)) / speed);
    before += s.end - s.start;
  }
  return null;
}

/** Where playback should be next: inside a kept section as is, else the start of the next one, else back to the first (loop). */
export function nextPlayable(sourceTime: number, segments: Range[]): number {
  for (const s of segments) {
    if (sourceTime < s.start) return s.start;
    if (sourceTime < s.end - 0.03) return sourceTime;
  }
  return segments.length ? segments[0].start : sourceTime;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The crop rectangle (fractions of the upright frame) for an aspect, zoom and pan.
 * `frameW`/`frameH` are the frame as seen after rotation. Original aspect with zoom 1 is no crop (null).
 */
export function cropRectFor(aspect: AspectId, zoom: number, panX: number, panY: number, frameW: number, frameH: number): CropRect | null {
  const target = ASPECTS.find((a) => a.id === aspect)?.ratio ?? frameW / frameH;
  const frameRatio = frameW / frameH;
  // Largest rectangle of the target ratio inside the frame, then shrunk by the zoom.
  let w = 1;
  let h = 1;
  if (target > frameRatio) h = frameRatio / target;
  else w = target / frameRatio;
  const z = clamp(zoom, 1, 4);
  w /= z;
  h /= z;
  if (w >= 0.999 && h >= 0.999) return null;
  const x = (1 - w) / 2 + (clamp(panX, -1, 1) * (1 - w)) / 2;
  const y = (1 - h) / 2 + (clamp(panY, -1, 1) * (1 - h)) / 2;
  return { x: r3(clamp(x, 0, 1 - w)), y: r3(clamp(y, 0, 1 - h)), w: r3(w), h: r3(h) };
}

/** CSS filter that previews the look. It is an approximation of what the server renders, close enough to choose by. */
export function lookCss(e: Pick<EditState, 'preset' | 'brightness' | 'contrast' | 'saturation'>): string {
  const p = LOOKS[e.preset];
  const brightness = clamp(1 + p.brightness + e.brightness, 0, 2);
  const contrast = clamp(p.contrast * e.contrast, 0, 3);
  const saturation = clamp(p.saturation * e.saturation, 0, 4);
  const parts = [`brightness(${r3(brightness)})`, `contrast(${r3(contrast)})`, `saturate(${r3(saturation)})`];
  if (p.sepia > 0) parts.push(`sepia(${p.sepia})`);
  return parts.join(' ');
}

/** Text safe to send: no control characters, no emoji (the server's font cannot draw them), single spaces. */
export function cleanOverlayText(raw: string): string {
  return raw
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u{10000}-\u{10ffff}]/gu, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * The `edits` JSON for the upload, or null when there is nothing beyond the plain trim (which keeps using
 * trimStart/trimEnd exactly as before).
 *
 * `frame` is the source frame size when the app knows it exactly (the browser does): the crop is then sent as a
 * rectangle. When it does not (the phone app is only told sizes that may ignore rotation), the crop is sent as a
 * shape — aspect, zoom, pan — and the server places it from the real frame.
 */
export function buildEditsPayload(window: Range, e: EditState, frame: { width: number; height: number } | null): Record<string, unknown> | null {
  if (isUnedited(e)) return null;
  const payload: Record<string, unknown> = {
    segments: segmentsFor(window, e.cuts),
    speed: e.speed,
    rotate: e.rotate,
    flipH: e.flipH,
    flipV: e.flipV,
    look: { preset: e.preset, brightness: e.brightness, contrast: e.contrast, saturation: e.saturation },
    fadeIn: e.fadeIn,
    fadeOut: e.fadeOut,
    volume: e.volume,
    texts: e.texts
      .map((t) => ({ text: cleanOverlayText(t.text), start: t.start, end: t.end, x: t.x, y: t.y, size: t.size, color: t.color, box: t.box }))
      .filter((t) => t.text),
  };
  if (e.aspect !== 'original') {
    if (frame) {
      const upright = e.rotate % 180 === 0 ? frame : { width: frame.height, height: frame.width };
      const crop = cropRectFor(e.aspect, e.zoom, e.panX, e.panY, upright.width, upright.height);
      if (crop) payload.crop = crop;
    } else {
      payload.frame = { aspect: e.aspect, zoom: e.zoom, panX: e.panX, panY: e.panY };
    }
  }
  return payload;
}

/** Human summary of what was changed, for the chip in the upload dialog. */
export function describeEdit(window: Range, e: EditState): string {
  const bits: string[] = [];
  if (e.cuts.length) bits.push(`${e.cuts.length} cut${e.cuts.length === 1 ? '' : 's'}`);
  if (e.speed !== 1) bits.push(`${e.speed}× speed`);
  if (e.rotate || e.flipH || e.flipV) bits.push('rotated/flipped');
  if (e.aspect !== 'original') bits.push(`${e.aspect} crop`);
  if (e.preset !== 'none' || e.brightness !== 0 || e.contrast !== 1 || e.saturation !== 1) bits.push('colour');
  if (e.fadeIn || e.fadeOut) bits.push('fades');
  if (e.volume !== 1) bits.push(e.volume === 0 ? 'muted' : 'volume');
  if (e.texts.length) bits.push(`${e.texts.length} text${e.texts.length === 1 ? '' : 's'}`);
  return bits.length ? bits.join(' · ') : `${Math.round(outputSeconds(window, e) * 10) / 10}s`;
}

/** Keeps text items inside the edited clip after the length changed (drop those starting past the end, trim the rest). */
export function fitTextsToLength(texts: TextItem[], length: number): TextItem[] {
  return texts
    .filter((t) => t.start < length - 0.05)
    .map((t) => (t.end > length ? { ...t, end: r3(length) } : t))
    .filter((t) => t.end - t.start >= 0.2);
}

/** Breaks text into lines of at most `width` characters (over-long words are split). Same rule as the server. */
export function wrapOverlayLines(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      let w = word;
      while (w.length > width) {
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if ((line + ' ' + w).length <= width) line += ' ' + w;
      else {
        lines.push(line);
        line = w;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Wraps and sizes a caption so it fits the frame in at most 3 lines — the same layout the server renders, drawn here at preview scale. */
export function layoutOverlay(text: string, frameWidth: number, frameHeight: number, sizeFraction: number): { lines: string[]; fontSize: number } {
  let size = Math.max(10, Math.round(frameHeight * sizeFraction));
  for (;;) {
    const border = Math.round(size * 0.3);
    const maxChars = Math.max(4, Math.floor((frameWidth * 0.92 - 2 * border) / (size * 0.68)));
    const lines = wrapOverlayLines(text, maxChars);
    if (lines.length <= 3 || size <= 10) return { lines: lines.slice(0, 3), fontSize: size };
    size = Math.max(10, Math.floor(size * 0.9));
  }
}
