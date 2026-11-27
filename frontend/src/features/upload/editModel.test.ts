import { describe, expect, it } from 'vitest';
import { buildEditsPayload, cropRectFor, defaultEdit, editedTimeAt, fitTextsToLength, isUnedited, lookCss, nextPlayable, outputSeconds, segmentsFor, cleanOverlayText, describeEdit } from './editModel';
import { storedSize } from '../../lib/frameStandard';

const win = { start: 0, end: 20 };

describe('segments and length', () => {
  it('cuts are removed from the trim window', () => {
    expect(segmentsFor(win, [{ start: 5, end: 8 }])).toEqual([{ start: 0, end: 5 }, { start: 8, end: 20 }]);
    expect(segmentsFor({ start: 2, end: 10 }, [{ start: 0, end: 4 }])).toEqual([{ start: 4, end: 10 }]); // a cut overlapping the window edge
  });
  it('overlapping cuts merge; slivers under the minimum disappear', () => {
    expect(segmentsFor(win, [{ start: 5, end: 9 }, { start: 8, end: 12 }])).toEqual([{ start: 0, end: 5 }, { start: 12, end: 20 }]);
    expect(segmentsFor(win, [{ start: 0.2, end: 20 }])).toEqual([]);
  });
  it('length is kept time divided by speed', () => {
    const e = { ...defaultEdit(), cuts: [{ start: 5, end: 10 }], speed: 1.5 };
    expect(outputSeconds(win, e)).toBe(10);
  });
  it('maps source moments onto the edited timeline and skips cut parts during playback', () => {
    const segs = segmentsFor(win, [{ start: 5, end: 8 }]);
    expect(editedTimeAt(4, segs, 1)).toBe(4);
    expect(editedTimeAt(9, segs, 1)).toBe(6);
    expect(editedTimeAt(6, segs, 1)).toBeNull();
    expect(editedTimeAt(9, segs, 2)).toBe(3);
    expect(nextPlayable(6, segs)).toBe(8);
    expect(nextPlayable(19.99, segs)).toBe(0); // loops
    expect(nextPlayable(3, segs)).toBe(3);
  });
});

describe('crop', () => {
  it('original aspect at zoom 1 is no crop', () => {
    expect(cropRectFor('original', 1, 0, 0, 1920, 1080)).toBeNull();
  });
  it('9:16 out of a landscape frame is a centred tall strip', () => {
    const c = cropRectFor('9:16', 1, 0, 0, 1920, 1080)!;
    expect(c.h).toBe(1);
    expect(c.w).toBeCloseTo((9 / 16) / (1920 / 1080), 3);
    expect(c.x + c.w / 2).toBeCloseTo(0.5, 2);
  });
  it('pan moves the window but never outside the frame; zoom shrinks it', () => {
    const left = cropRectFor('1:1', 1, -1, 0, 1920, 1080)!;
    const right = cropRectFor('1:1', 1, 1, 0, 1920, 1080)!;
    expect(left.x).toBe(0);
    expect(right.x + right.w).toBeCloseTo(1, 2);
    const z = cropRectFor('1:1', 2, 0, 0, 1920, 1080)!;
    expect(z.h).toBeCloseTo(0.5, 2);
  });
});

describe('payload', () => {
  const frame = { width: 1920, height: 1080 };
  it('nothing edited means no payload (the plain trim fields are used instead)', () => {
    expect(isUnedited(defaultEdit())).toBe(true);
    expect(buildEditsPayload(win, defaultEdit(), frame)).toBeNull();
  });
  it('carries segments, speed, look and cleaned text', () => {
    const e = { ...defaultEdit(), speed: 2, preset: 'warm' as const, cuts: [{ start: 5, end: 8 }], texts: [{ id: 'a', text: ' Sale 😀 now ', start: 0, end: 3, x: 0.5, y: 0.8, size: 0.05, color: '#FFFFFF', box: true }] };
    const p = buildEditsPayload(win, e, frame)!;
    expect(p.segments).toEqual([{ start: 0, end: 5 }, { start: 8, end: 20 }]);
    expect(p.speed).toBe(2);
    expect((p.texts as any[])[0].text).toBe('Sale now');
    expect(p.crop).toBeUndefined();
  });
  it('rotating by 90 swaps the frame the crop is computed on', () => {
    const e = { ...defaultEdit(), rotate: 90 as const, aspect: '9:16' as const };
    // 1920x1080 rotated is 1080x1920: already 9:16, so no crop is needed
    expect(buildEditsPayload(win, e, frame)!.crop).toBeUndefined();
    const e2 = { ...defaultEdit(), aspect: '9:16' as const };
    expect(buildEditsPayload(win, e2, frame)!.crop).toBeDefined();
  });
  it('without a known frame size the crop is sent as a shape for the server to place', () => {
    const p = buildEditsPayload(win, { ...defaultEdit(), aspect: '1:1' as const, zoom: 1.5, panX: 0.2 }, null)!;
    expect(p.crop).toBeUndefined();
    expect(p.frame).toEqual({ aspect: '1:1', zoom: 1.5, panX: 0.2, panY: 0 });
  });
  it('texts are re-fitted when the clip gets shorter', () => {
    const t = (start: number, end: number) => ({ id: `${start}`, text: 'x', start, end, x: 0, y: 0, size: 0.05, color: '#FFFFFF', box: true });
    expect(fitTextsToLength([t(0, 9), t(8, 9), t(0, 0.1)], 5)).toEqual([{ ...t(0, 9), end: 5 }, ]);
  });
  it('describes the edit for the summary chip', () => {
    expect(describeEdit(win, { ...defaultEdit(), speed: 1.5, cuts: [{ start: 1, end: 2 }] })).toBe('1 cut · 1.5× speed');
  });
});

describe('look and text helpers', () => {
  it('look preview is a CSS filter that follows the sliders', () => {
    expect(lookCss(defaultEdit())).toBe('brightness(1) contrast(1) saturate(1)');
    expect(lookCss({ preset: 'sepia', brightness: 0, contrast: 1, saturation: 1 })).toContain('sepia(1)');
    expect(lookCss({ preset: 'mono', brightness: 0, contrast: 1, saturation: 1 })).toContain('saturate(0)');
  });
  it('emoji and control characters are removed from overlay text', () => {
    expect(cleanOverlayText('a\u0007  b 😀')).toBe('a b');
  });
});

describe('frame standard', () => {
  it('4K is announced as 1080p, small videos are left alone', () => {
    expect(storedSize(3840, 2160)).toEqual({ width: 1920, height: 1080, changed: true });
    expect(storedSize(2160, 3840)).toEqual({ width: 1080, height: 1920, changed: true });
    expect(storedSize(1280, 720).changed).toBe(false);
    expect(storedSize(1079, 1919)).toEqual({ width: 1078, height: 1918, changed: true });
  });
});
