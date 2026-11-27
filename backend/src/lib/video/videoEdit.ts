import { HttpError } from '../core/httpError';
import { MAX_VIDEO_SECONDS, MIN_VIDEO_SECONDS } from './videoLimits';
import { buildAudioFilter } from './audioMix';
import { FRAME_STANDARD, VideoProbe, fitFrame, fpsCap } from './videoStandard';

/**
 * Editing instructions sent with an upload (multipart field `edits`, JSON).
 * Everything is optional; an absent field means "leave as is". The server is
 * the authority: the app's editor only *proposes* these values, and
 * resolveEdits() re-validates and normalizes every one before any ffmpeg work.
 *
 * Times in `segments` are seconds in the SOURCE file; times in `texts` are
 * seconds in the EDITED clip (what the viewer sees, after cuts and speed).
 */

export const EDIT_LIMITS = {
  minSpeed: 0.25,
  maxSpeed: 4,
  maxSegments: 12,
  /** Shortest kept piece — anything shorter is a stray click on the timeline, not an intentional cut. */
  minSegmentSeconds: 0.3,
  maxTexts: 5,
  maxTextChars: 80,
  maxFadeSeconds: 3,
  minCropFraction: 0.1,
  maxVolume: 2,
} as const;

/** Colour looks. Each is a plain brightness/contrast/saturation(/sepia) recipe so the app can preview the same thing with CSS filters. */
export const LOOK_PRESETS = {
  none: { brightness: 0, contrast: 1, saturation: 1, sepia: 0 },
  vivid: { brightness: 0, contrast: 1.1, saturation: 1.35, sepia: 0 },
  pop: { brightness: 0.01, contrast: 1.2, saturation: 1.2, sepia: 0 },
  warm: { brightness: 0.02, contrast: 1.05, saturation: 1.15, sepia: 0.25 },
  fade: { brightness: 0.06, contrast: 0.85, saturation: 0.8, sepia: 0 },
  mono: { brightness: 0, contrast: 1, saturation: 0, sepia: 0 },
  noir: { brightness: -0.05, contrast: 1.3, saturation: 0, sepia: 0 },
  sepia: { brightness: 0, contrast: 1, saturation: 1, sepia: 1 },
} as const;
export type LookPresetId = keyof typeof LOOK_PRESETS;

export interface EditSegment {
  start: number;
  end: number;
}
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** An aspect-ratio crop the server places itself, from the real frame size — for clients that don't know it exactly (the phone app). */
export const FRAME_ASPECTS = { '9:16': 9 / 16, '4:5': 4 / 5, '1:1': 1, '16:9': 16 / 9 } as const;
export type FrameAspectId = keyof typeof FRAME_ASPECTS;
export interface FrameCrop {
  aspect: FrameAspectId;
  /** 1 = the largest crop of that shape, up to 4 = a quarter of that size. */
  zoom: number;
  /** -1 (left/top) … 1 (right/bottom). */
  panX: number;
  panY: number;
}

/** The crop rectangle (fractions of the upright w×h frame) for an aspect crop; null when it would be the whole frame. Same maths as cropRectFor in the apps. */
export function cropRectFromFrame(f: FrameCrop, w: number, h: number): CropRect | null {
  const target = FRAME_ASPECTS[f.aspect];
  const frameRatio = w / h;
  let cw = 1;
  let ch = 1;
  if (target > frameRatio) ch = frameRatio / target;
  else cw = target / frameRatio;
  cw /= f.zoom;
  ch /= f.zoom;
  if (cw >= 0.999 && ch >= 0.999) return null;
  const x = (1 - cw) / 2 + (f.panX * (1 - cw)) / 2;
  const y = (1 - ch) / 2 + (f.panY * (1 - ch)) / 2;
  return { x: Math.min(Math.max(x, 0), 1 - cw), y: Math.min(Math.max(y, 0), 1 - ch), w: cw, h: ch };
}

export interface TextOverlay {
  text: string;
  start: number;
  end: number;
  /** 0 = left/top edge, 1 = right/bottom edge of the frame (the box is kept inside the frame). */
  x: number;
  y: number;
  /** Font height as a fraction of the frame height. */
  size: number;
  /** #RRGGBB */
  color: string;
  /** Draw a translucent dark box behind the text for legibility. */
  box: boolean;
}

export interface ResolvedEdits {
  segments: EditSegment[];
  speed: number;
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  crop: CropRect | null;
  /** Alternative to `crop`: an aspect crop placed by the server. At most one of the two is set. */
  frame: FrameCrop | null;
  look: { preset: LookPresetId; brightness: number; contrast: number; saturation: number };
  fadeIn: number;
  fadeOut: number;
  /** Volume of the video's own sound (ignored when the uploader adds an audio track instead). */
  volume: number;
  texts: TextOverlay[];
}

export interface EditPlan {
  edits: ResolvedEdits;
  /** Length of the edited clip in seconds: kept source time ÷ speed. */
  outputSeconds: number;
}

function bad(message: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(400, message, { code: 'INVALID_EDIT', ...(details ? { details } : {}) });
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function numberIn(raw: unknown, fallback: number, lo: number, hi: number, label: string): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = typeof raw === 'number' ? raw : Number(String(raw));
  if (!Number.isFinite(n)) throw bad(`${label} must be a number`);
  if (n < lo || n > hi) throw bad(`${label} must be between ${lo} and ${hi}`);
  return n;
}

function boolish(raw: unknown): boolean {
  return raw === true || raw === 'true' || raw === 1 || raw === '1';
}

/** Text that is safe to draw: no control characters, no characters outside the basic multilingual plane (emoji — the font can't draw them), single spaces. */
export function sanitizeOverlayText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u{10000}-\u{10ffff}]/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();
}

/** Breaks text into lines of at most `width` characters (at spaces where possible; over-long words are split). */
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

/** Average glyph width of the overlay font (bold sans) as a multiple of the font size — digits and capitals are the widest. */
const GLYPH_WIDTH = 0.68;
const MAX_OVERLAY_LINES = 3;
const MIN_OVERLAY_FONT_PX = 10;

/**
 * Lays an overlay out so it always fits inside the frame: wraps at the width the frame allows for the chosen
 * font size, and if that needs more than 3 lines, shrinks the font until it doesn't. Pure, so it is tested
 * without ffmpeg; the frame a caption is drawn on is the *stored* frame (after the size standard).
 */
export function layoutOverlay(text: string, frameWidth: number, frameHeight: number, sizeFraction: number): { text: string; fontSize: number } {
  let size = Math.max(MIN_OVERLAY_FONT_PX, Math.round(frameHeight * sizeFraction));
  for (;;) {
    const border = Math.round(size * 0.3);
    const maxChars = Math.max(4, Math.floor((frameWidth * 0.92 - 2 * border) / (size * GLYPH_WIDTH)));
    const lines = wrapOverlayLines(text, maxChars);
    if (lines.length <= MAX_OVERLAY_LINES || size <= MIN_OVERLAY_FONT_PX) {
      return { text: lines.slice(0, MAX_OVERLAY_LINES).join('\n'), fontSize: size };
    }
    size = Math.max(MIN_OVERLAY_FONT_PX, Math.floor(size * 0.9));
  }
}

function resolveSegments(raw: unknown, duration: number): EditSegment[] {
  if (raw === undefined || raw === null) return [{ start: 0, end: round3(duration) }];
  if (!Array.isArray(raw) || raw.length === 0) throw bad('Choose at least one section of the video to keep');
  if (raw.length > EDIT_LIMITS.maxSegments) throw bad(`At most ${EDIT_LIMITS.maxSegments} sections can be kept`);
  const out: EditSegment[] = [];
  let previousEnd = 0;
  for (const item of raw) {
    const start = Number((item as any)?.start);
    const endIn = Number((item as any)?.end);
    if (!Number.isFinite(start) || !Number.isFinite(endIn)) throw bad('Section times must be numbers of seconds');
    if (start < 0) throw bad('A section cannot start before the beginning of the video');
    if (start >= duration - 0.05) throw bad(`A section starts at ${Math.round(start * 10) / 10}s, past the end of the video (${Math.round(duration * 10) / 10}s)`, { duration });
    const end = Math.min(endIn, duration);
    if (end - start < EDIT_LIMITS.minSegmentSeconds - 0.001) throw bad(`Each kept section must be at least ${EDIT_LIMITS.minSegmentSeconds} seconds long`);
    if (start < previousEnd - 0.001) throw bad('Kept sections must be in order and must not overlap');
    out.push({ start: round3(start), end: round3(end) });
    previousEnd = end;
  }
  return out;
}

function resolveCrop(raw: unknown): CropRect | null {
  if (raw === undefined || raw === null) return null;
  const c = raw as Record<string, unknown>;
  const x = Number(c.x);
  const y = Number(c.y);
  const w = Number(c.w);
  const h = Number(c.h);
  if (![x, y, w, h].every(Number.isFinite)) throw bad('Crop values must be numbers');
  const min = EDIT_LIMITS.minCropFraction;
  if (x < 0 || y < 0 || w < min || h < min || w > 1 || h > 1 || x + w > 1.0001 || y + h > 1.0001) {
    throw bad('The crop must stay inside the picture and cover at least 10% of it in each direction');
  }
  if (w >= 0.999 && h >= 0.999) return null; // the whole frame is no crop at all
  return { x: round3(x), y: round3(y), w: round3(Math.min(w, 1 - x)), h: round3(Math.min(h, 1 - y)) };
}

function resolveFrame(raw: unknown): FrameCrop | null {
  if (raw === undefined || raw === null) return null;
  const f = raw as Record<string, unknown>;
  const aspect = String(f.aspect);
  if (!Object.prototype.hasOwnProperty.call(FRAME_ASPECTS, aspect)) throw bad('Crop shape must be 9:16, 4:5, 1:1 or 16:9');
  return {
    aspect: aspect as FrameAspectId,
    zoom: round3(numberIn(f.zoom, 1, 1, 4, 'Zoom')),
    panX: round3(numberIn(f.panX, 0, -1, 1, 'Crop position')),
    panY: round3(numberIn(f.panY, 0, -1, 1, 'Crop position')),
  };
}

function resolveTexts(raw: unknown, outputSeconds: number): TextOverlay[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw bad('Text overlays must be a list');
  if (raw.length > EDIT_LIMITS.maxTexts) throw bad(`At most ${EDIT_LIMITS.maxTexts} text overlays can be added`);
  return raw.map((item, i) => {
    const t = item as Record<string, unknown>;
    const text = sanitizeOverlayText(t.text);
    if (!text) throw bad(`Text overlay ${i + 1} is empty`);
    if (text.length > EDIT_LIMITS.maxTextChars) throw bad(`Text overlay ${i + 1} is longer than ${EDIT_LIMITS.maxTextChars} characters`);
    const start = numberIn(t.start, 0, 0, Infinity, 'Text start');
    const endIn = numberIn(t.end, outputSeconds, 0, Infinity, 'Text end');
    if (start >= outputSeconds - 0.05) throw bad(`Text overlay ${i + 1} starts after the end of the clip`);
    const end = Math.min(endIn, outputSeconds);
    if (end - start < 0.2) throw bad(`Text overlay ${i + 1} must be shown for at least 0.2 seconds`);
    const color = typeof t.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color.toUpperCase() : t.color === undefined || t.color === null ? '#FFFFFF' : null;
    if (!color) throw bad(`Text overlay ${i + 1} has an invalid colour (use #RRGGBB)`);
    return {
      text,
      start: round3(start),
      end: round3(end),
      x: round3(numberIn(t.x, 0.5, 0, 1, 'Text position')),
      y: round3(numberIn(t.y, 0.8, 0, 1, 'Text position')),
      size: round3(numberIn(t.size, 0.05, 0.02, 0.12, 'Text size')),
      color,
      box: t.box === undefined ? true : boolish(t.box),
    };
  });
}

/**
 * Validates the `edits` field and works out the edited clip's length. Pure
 * (no I/O). Throws HttpError(400, INVALID_EDIT) for bad input and
 * HttpError(400, VIDEO_TOO_LONG) when the edited clip would exceed the cap —
 * measured AFTER cuts and speed, because that is what gets published.
 */
export function resolveEdits(rawInput: unknown, sourceDuration: number): EditPlan {
  let raw: any = rawInput;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw bad('Edits must be valid JSON');
    }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw bad('Edits must be an object');

  const segments = resolveSegments(raw.segments, sourceDuration);
  const speed = numberIn(raw.speed, 1, EDIT_LIMITS.minSpeed, EDIT_LIMITS.maxSpeed, 'Speed');
  const kept = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  const outputSeconds = round3(kept / speed);

  if (outputSeconds < MIN_VIDEO_SECONDS - 0.05) {
    throw bad(`The edited video must be at least ${MIN_VIDEO_SECONDS} second long`);
  }
  if (outputSeconds > MAX_VIDEO_SECONDS + 0.05) {
    throw new HttpError(
      400,
      `Videos can be at most ${MAX_VIDEO_SECONDS} seconds (this edit comes to ${Math.round(outputSeconds)}s). Cut it down or speed it up.`,
      { code: 'VIDEO_TOO_LONG', details: { duration: sourceDuration, maxSeconds: MAX_VIDEO_SECONDS } }
    );
  }

  if (raw.crop !== undefined && raw.crop !== null && raw.frame !== undefined && raw.frame !== null) {
    throw bad('Send either a crop rectangle or a crop shape, not both');
  }
  const rotateIn = numberIn(raw.rotate, 0, 0, 360, 'Rotation');
  if (![0, 90, 180, 270, 360].includes(rotateIn)) throw bad('Rotation must be 0, 90, 180 or 270 degrees');

  const lookRaw = (raw.look ?? {}) as Record<string, unknown>;
  const preset = lookRaw.preset === undefined || lookRaw.preset === null ? 'none' : String(lookRaw.preset);
  if (!Object.prototype.hasOwnProperty.call(LOOK_PRESETS, preset)) throw bad(`Unknown look "${preset}"`);

  const fadeCap = Math.min(EDIT_LIMITS.maxFadeSeconds, outputSeconds / 2);
  const fadeIn = round3(Math.min(numberIn(raw.fadeIn, 0, 0, EDIT_LIMITS.maxFadeSeconds, 'Fade in'), fadeCap));
  const fadeOut = round3(Math.min(numberIn(raw.fadeOut, 0, 0, EDIT_LIMITS.maxFadeSeconds, 'Fade out'), fadeCap));

  return {
    outputSeconds,
    edits: {
      segments,
      speed: round3(speed),
      rotate: (rotateIn % 360) as ResolvedEdits['rotate'],
      flipH: boolish(raw.flipH),
      flipV: boolish(raw.flipV),
      crop: resolveCrop(raw.crop),
      frame: resolveFrame(raw.frame),
      look: {
        preset: preset as LookPresetId,
        brightness: round3(numberIn(lookRaw.brightness, 0, -0.5, 0.5, 'Brightness')),
        contrast: round3(numberIn(lookRaw.contrast, 1, 0.5, 1.5, 'Contrast')),
        saturation: round3(numberIn(lookRaw.saturation, 1, 0, 2, 'Saturation')),
      },
      fadeIn,
      fadeOut,
      volume: round3(numberIn(raw.volume, 1, 0, EDIT_LIMITS.maxVolume, 'Volume')),
      texts: resolveTexts(raw.texts, outputSeconds),
    },
  };
}

/** True when the edits change nothing about the picture or sound beyond the kept range — the simple transcode path suffices. */
export function isPlainCut(e: ResolvedEdits): boolean {
  return (
    e.segments.length === 1 &&
    e.speed === 1 &&
    e.rotate === 0 &&
    !e.flipH &&
    !e.flipV &&
    !e.crop &&
    !e.frame &&
    e.look.preset === 'none' &&
    e.look.brightness === 0 &&
    e.look.contrast === 1 &&
    e.look.saturation === 1 &&
    e.fadeIn === 0 &&
    e.fadeOut === 0 &&
    e.volume === 1 &&
    e.texts.length === 0
  );
}

// ---- ffmpeg graph ----------------------------------------------------------

function n(x: number): string {
  return String(round3(x));
}

/** Escapes a value for use inside single quotes in a filter graph. */
function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "'\\''")}'`;
}

/** `atempo` only takes 0.5–2 per instance in older ffmpeg builds, so wider speeds are chained. */
export function tempoChain(speed: number): string[] {
  if (speed === 1) return [];
  const out: string[] = [];
  let left = speed;
  while (left > 2) {
    out.push('atempo=2');
    left /= 2;
  }
  while (left < 0.5) {
    out.push('atempo=0.5');
    left /= 0.5;
  }
  out.push(`atempo=${n(left)}`);
  return out;
}

/** The colour recipe actually applied: the preset combined with the manual sliders. */
export function effectiveLook(look: ResolvedEdits['look']) {
  const p = LOOK_PRESETS[look.preset];
  return {
    brightness: round3(Math.max(-1, Math.min(1, p.brightness + look.brightness))),
    contrast: round3(p.contrast * look.contrast),
    saturation: round3(p.saturation * look.saturation),
    sepia: p.sepia,
  };
}

/** The 3×3 sepia matrix for an amount 0–1 (the same definition CSS `sepia()` uses, so the preview matches). */
function sepiaMixer(a: number): string {
  const k = 1 - a;
  const m = [
    [0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k],
    [0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k],
    [0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k],
  ];
  const names = [['rr', 'rg', 'rb'], ['gr', 'gg', 'gb'], ['br', 'bg', 'bb']];
  return 'colorchannelmixer=' + m.flatMap((row, i) => row.map((v, j) => `${names[i][j]}=${v.toFixed(4)}`)).join(':');
}

/** Where in the source the edit reads from: seek here and read this many seconds (nothing before or after is decoded). */
export function inputWindow(plan: EditPlan): { start: number; duration: number } {
  const first = plan.edits.segments[0];
  const last = plan.edits.segments[plan.edits.segments.length - 1];
  return { start: first.start, duration: round3(last.end - first.start) };
}

export interface GraphContext {
  probe: VideoProbe;
  /** The source has a sound track. */
  sourceHasAudio: boolean;
  /** The uploader supplied an audio track (input 1) that replaces the source sound. */
  addedAudioVolume: number | null;
  /** Font for text overlays; null when the server has none installed. */
  fontFile: string | null;
  /** Writes one overlay's text to a file and returns its path (text goes through a file so it never needs filter escaping). */
  writeText: (index: number, text: string) => string;
}

export interface EditGraph {
  filterComplex: string[];
  videoLabel: string;
  audioLabel: string | null;
  /** Size of the stored frame. */
  width: number;
  height: number;
}

/**
 * Builds the ffmpeg `-filter_complex` graph for a set of edits plus the frame
 * standard. Order: cut → rotate/flip → crop → fit to the standard → speed →
 * look → fades → text. Fades and text come last so their times are on the
 * edited clip's own timeline.
 */
export function buildEditGraph(plan: EditPlan, ctx: GraphContext): EditGraph {
  const e = plan.edits;
  const out = plan.outputSeconds;
  const withSourceAudio = ctx.sourceHasAudio && ctx.addedAudioVolume === null;
  const filters: string[] = [];

  // 1. cut (and join) the kept sections. The caller seeks the input to the first section's start (inputWindow),
  //    so section times here are relative to that point.
  const base0 = e.segments[0].start;
  const seg = e.segments.map((s) => ({ start: round3(s.start - base0), end: round3(s.end - base0) }));
  if (seg.length === 1) {
    filters.push(`[0:v]trim=start=${n(seg[0].start)}:end=${n(seg[0].end)},setpts=PTS-STARTPTS[vcat]`);
    if (withSourceAudio) filters.push(`[0:a]atrim=start=${n(seg[0].start)}:end=${n(seg[0].end)},asetpts=PTS-STARTPTS[acat]`);
  } else {
    seg.forEach((s, i) => {
      filters.push(`[0:v]trim=start=${n(s.start)}:end=${n(s.end)},setpts=PTS-STARTPTS[v${i}]`);
      if (withSourceAudio) filters.push(`[0:a]atrim=start=${n(s.start)}:end=${n(s.end)},asetpts=PTS-STARTPTS[a${i}]`);
    });
    const pads = seg.map((_, i) => (withSourceAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join('');
    filters.push(`${pads}concat=n=${seg.length}:v=1:a=${withSourceAudio ? 1 : 0}[vcat]${withSourceAudio ? '[acat]' : ''}`);
  }

  // 2. picture geometry
  const v: string[] = [];
  if (e.rotate === 90) v.push('transpose=1');
  else if (e.rotate === 180) v.push('hflip', 'vflip');
  else if (e.rotate === 270) v.push('transpose=2');
  if (e.flipH) v.push('hflip');
  if (e.flipV) v.push('vflip');

  let w = ctx.probe.width;
  let h = ctx.probe.height;
  if (e.rotate === 90 || e.rotate === 270) [w, h] = [h, w];
  const cropRect = e.crop ?? (e.frame ? cropRectFromFrame(e.frame, w, h) : null);
  if (cropRect) {
    const cw = Math.max(2, Math.floor((w * cropRect.w) / 2) * 2);
    const ch = Math.max(2, Math.floor((h * cropRect.h) / 2) * 2);
    const cx = Math.min(w - cw, Math.floor((w * cropRect.x) / 2) * 2);
    const cy = Math.min(h - ch, Math.floor((h * cropRect.y) / 2) * 2);
    v.push(`crop=${cw}:${ch}:${cx}:${cy}`);
    w = cw;
    h = ch;
  }
  const fit = fitFrame(w, h);
  if (fit.scaled) v.push(`scale=${fit.width}:${fit.height}:flags=lanczos`);
  v.push('setsar=1');

  // 3. speed
  if (e.speed !== 1) v.push(`setpts=PTS/${n(e.speed)}`);
  const effectiveFps = ctx.probe.fps === null ? null : ctx.probe.fps * e.speed;
  const capped = fpsCap(effectiveFps);
  if (capped !== null) v.push(`fps=${capped}`);
  else if (e.speed < 1 && ctx.probe.fps !== null) v.push(`fps=${Math.min(FRAME_STANDARD.maxFps, Math.round(ctx.probe.fps))}`);

  // 4. look
  const look = effectiveLook(e.look);
  if (look.brightness !== 0 || look.contrast !== 1 || look.saturation !== 1) {
    v.push(`eq=brightness=${n(look.brightness)}:contrast=${n(look.contrast)}:saturation=${n(look.saturation)}`);
  }
  if (look.sepia > 0) v.push(sepiaMixer(look.sepia));

  // 5. fades
  if (e.fadeIn > 0) v.push(`fade=t=in:st=0:d=${n(e.fadeIn)}`);
  if (e.fadeOut > 0) v.push(`fade=t=out:st=${n(Math.max(0, out - e.fadeOut))}:d=${n(e.fadeOut)}`);

  // 6. text
  if (e.texts.length) {
    if (!ctx.fontFile) {
      throw new HttpError(422, 'Text overlays are not available on this server right now (no font installed). Remove the text and try again.', { code: 'TEXT_UNAVAILABLE' });
    }
    e.texts.forEach((t, i) => {
      const laid = layoutOverlay(t.text, fit.width, fit.height, t.size);
      const file = ctx.writeText(i, laid.text);
      const size = laid.fontSize;
      const parts = [
        `fontfile=${quote(ctx.fontFile as string)}`,
        `textfile=${quote(file)}`,
        `fontsize=${size}`,
        `fontcolor=0x${t.color.slice(1)}`,
        `x=(w-text_w)*${n(t.x)}`,
        `y=(h-text_h)*${n(t.y)}`,
      ];
      if (t.box) parts.push('box=1', 'boxcolor=black@0.5', `boxborderw=${Math.max(4, Math.round(size * 0.3))}`);
      parts.push(`enable=${quote(`between(t,${n(t.start)},${n(t.end)})`)}`);
      v.push(`drawtext=${parts.join(':')}`);
    });
  }

  v.push('format=yuv420p');
  filters.push(`[vcat]${v.join(',')}[vout]`);

  // 7. sound
  let audioLabel: string | null = null;
  const fades: string[] = [];
  if (e.fadeIn > 0) fades.push(`afade=t=in:st=0:d=${n(e.fadeIn)}`);
  if (e.fadeOut > 0) fades.push(`afade=t=out:st=${n(Math.max(0, out - e.fadeOut))}:d=${n(e.fadeOut)}`);
  if (ctx.addedAudioVolume !== null) {
    // The uploader's own track replaces the video's sound (see audioMix.ts); fades go on after its padding.
    const base = buildAudioFilter({ audioVolume: ctx.addedAudioVolume }).replace(/\[aout\]$/, '');
    filters.push(`${[base, ...fades].join(',')}[aout]`);
    audioLabel = 'aout';
  } else if (withSourceAudio) {
    const a = [...tempoChain(e.speed)];
    if (e.volume !== 1) a.push(`volume=${n(e.volume)}`);
    a.push(...fades);
    filters.push(a.length ? `[acat]${a.join(',')}[aout]` : '[acat]anull[aout]');
    audioLabel = 'aout';
  }

  return { filterComplex: filters, videoLabel: 'vout', audioLabel, width: fit.width, height: fit.height };
}
