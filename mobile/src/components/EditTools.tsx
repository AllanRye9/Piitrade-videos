import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { Icon, SectionLabel } from './ui';
import {
  ASPECTS, EDIT_LIMITS, LOOKS, SPEEDS, TEXT_COLORS, defaultEdit, describeEdit, fitTextsToLength, isUnedited, outputSeconds,
} from '../lib/editModel';
import type { EditState, PresetId, Range, TextItem } from '../lib/editModel';
import { colors, radius, space } from '../theme';

type Tool = 'cut' | 'speed' | 'look' | 'frame' | 'text' | 'sound';
const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: 'cut', label: 'Cut' },
  { id: 'speed', label: 'Speed' },
  { id: 'look', label: 'Look' },
  { id: 'frame', label: 'Frame' },
  { id: 'text', label: 'Text' },
  { id: 'sound', label: 'Sound' },
];
const r1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;
let nextId = 1;

function Tune({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void }) {
  return (
    <View>
      <Text style={styles.small}>{label}</Text>
      <Slider minimumValue={min} maximumValue={max} step={step} value={value} onValueChange={onChange} minimumTrackTintColor={colors.brand} maximumTrackTintColor={colors.surfaceHigh} thumbTintColor={colors.brandSoft} accessibilityLabel={label} />
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!active }} style={[styles.chip, active && styles.chipOn]}>
      <Text style={[styles.chipText, active && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Editing tools for the upload sheet: cut parts out, speed, colour look, rotate/flip/crop, text captions, sound
 * level and fades. Nothing is re-encoded on the phone — the sheet sends these settings with the upload and the
 * server renders them (lib/editModel.ts is the shared rule set). The preview above reflects speed; colour, crop,
 * rotation and text appear in the posted video.
 */
export default function EditTools({
  window: win, edit, onChange, maxSeconds, hasMusic,
}: { window: Range; edit: EditState; onChange: (e: EditState) => void; maxSeconds: number; hasMusic: boolean }) {
  const [tool, setTool] = useState<Tool>('cut');
  const [textIndex, setTextIndex] = useState(0);
  const set = (patch: Partial<EditState>) => onChange({ ...edit, ...patch });
  const outLen = outputSeconds(win, edit);
  const changed = !isUnedited(edit);
  const texts = edit.texts;
  const cur = texts[Math.min(textIndex, Math.max(0, texts.length - 1))];
  const curIndex = cur ? texts.indexOf(cur) : -1;
  const patchText = (i: number, patch: Partial<TextItem>) => set({ texts: texts.map((t, k) => (k === i ? { ...t, ...patch } : t)) });
  const bad = changed && (outLen < 1 - 0.05 || outLen > maxSeconds + 0.05);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Icon name="color-wand-outline" size={16} color={colors.brandSoft} />
        <SectionLabel>Edit (optional)</SectionLabel>
        {changed ? (
          <Pressable onPress={() => onChange(defaultEdit())} hitSlop={8} style={{ marginLeft: 'auto' }}>
            <Text style={styles.reset}>Reset</Text>
          </Pressable>
        ) : null}
      </View>
      {changed ? <Text style={[styles.summary, bad && { color: colors.danger }]}>{describeEdit(win, edit)} · {r1(outLen)}s{bad ? ` — must be 1–${maxSeconds}s` : ''}</Text> : null}

      <View style={styles.row}>
        {TOOLS.map((t) => <Chip key={t.id} label={t.label} active={tool === t.id} onPress={() => setTool(t.id)} />)}
      </View>

      {tool === 'cut' && (
        <View style={{ gap: space.sm }}>
          <Text style={styles.small}>Remove a part from the middle of the clip.</Text>
          {edit.cuts.map((c, i) => (
            <View key={i} style={styles.cut}>
              <View style={styles.row}>
                <Text style={styles.value}>{fmt(c.start)} → {fmt(c.end)}</Text>
                <Pressable onPress={() => set({ cuts: edit.cuts.filter((_, k) => k !== i) })} hitSlop={8} accessibilityLabel={`Remove cut ${i + 1}`} style={{ marginLeft: 'auto' }}>
                  <Icon name="trash-outline" size={16} color={colors.danger} />
                </Pressable>
              </View>
              <Tune label="From" value={c.start} min={win.start} max={Math.max(win.start, c.end - EDIT_LIMITS.minSegment)} step={0.1} onChange={(v) => set({ cuts: edit.cuts.map((x, k) => (k === i ? { ...x, start: r1(v) } : x)) })} />
              <Tune label="To" value={c.end} min={Math.min(win.end, c.start + EDIT_LIMITS.minSegment)} max={win.end} step={0.1} onChange={(v) => set({ cuts: edit.cuts.map((x, k) => (k === i ? { ...x, end: r1(v) } : x)) })} />
            </View>
          ))}
          {edit.cuts.length < EDIT_LIMITS.maxCuts && (
            <Chip
              label="Cut out a part"
              onPress={() => {
                const mid = (win.start + win.end) / 2;
                set({ cuts: [...edit.cuts, { start: r1(Math.max(win.start, mid - 0.5)), end: r1(Math.min(win.end, mid + 0.5)) }] });
              }}
            />
          )}
        </View>
      )}

      {tool === 'speed' && (
        <View style={{ gap: space.sm }}>
          <View style={styles.row}>{SPEEDS.map((s) => <Chip key={s} label={`${s}×`} active={edit.speed === s} onPress={() => set({ speed: s })} />)}</View>
          <Text style={styles.small}>The {maxSeconds}-second limit is measured on the result, so speeding up lets you fit more in.</Text>
        </View>
      )}

      {tool === 'look' && (
        <View style={{ gap: space.sm }}>
          <View style={styles.row}>{(Object.keys(LOOKS) as PresetId[]).map((id) => <Chip key={id} label={LOOKS[id].label} active={edit.preset === id} onPress={() => set({ preset: id })} />)}</View>
          <Tune label="Brightness" value={edit.brightness} min={-0.5} max={0.5} step={0.05} onChange={(v) => set({ brightness: v })} />
          <Tune label="Contrast" value={edit.contrast} min={0.5} max={1.5} step={0.05} onChange={(v) => set({ contrast: v })} />
          <Tune label="Saturation" value={edit.saturation} min={0} max={2} step={0.05} onChange={(v) => set({ saturation: v })} />
        </View>
      )}

      {tool === 'frame' && (
        <View style={{ gap: space.sm }}>
          <View style={styles.row}>{ASPECTS.map((a) => <Chip key={a.id} label={a.label} active={edit.aspect === a.id} onPress={() => set({ aspect: a.id, zoom: 1, panX: 0, panY: 0 })} />)}</View>
          <View style={styles.row}>
            <Chip label="Rotate ⟲" onPress={() => set({ rotate: ((edit.rotate + 270) % 360) as EditState['rotate'] })} />
            <Chip label="Rotate ⟳" onPress={() => set({ rotate: ((edit.rotate + 90) % 360) as EditState['rotate'] })} />
            <Chip label="Flip ↔" active={edit.flipH} onPress={() => set({ flipH: !edit.flipH })} />
            <Chip label="Flip ↕" active={edit.flipV} onPress={() => set({ flipV: !edit.flipV })} />
          </View>
          {edit.aspect !== 'original' && (
            <>
              <Tune label="Zoom" value={edit.zoom} min={1} max={3} step={0.05} onChange={(v) => set({ zoom: v })} />
              <Tune label="Move left / right" value={edit.panX} min={-1} max={1} step={0.05} onChange={(v) => set({ panX: v })} />
              <Tune label="Move up / down" value={edit.panY} min={-1} max={1} step={0.05} onChange={(v) => set({ panY: v })} />
            </>
          )}
        </View>
      )}

      {tool === 'text' && (
        <View style={{ gap: space.sm }}>
          <View style={styles.row}>
            {texts.map((t, i) => <Chip key={t.id} label={(t.text.trim() || 'Text').slice(0, 12)} active={i === curIndex} onPress={() => setTextIndex(i)} />)}
            {texts.length < EDIT_LIMITS.maxTexts && (
              <Chip
                label="+ Add text"
                onPress={() => {
                  const item: TextItem = { id: `t${nextId++}`, text: 'Your text', start: 0, end: Math.max(1, Math.min(outLen, 3)), x: 0.5, y: 0.8, size: 0.05, color: '#FFFFFF', box: true };
                  set({ texts: [...texts, item] });
                  setTextIndex(texts.length);
                }}
              />
            )}
          </View>
          {cur && (
            <View style={{ gap: space.sm }}>
              <TextInput value={cur.text} onChangeText={(v) => patchText(curIndex, { text: v })} maxLength={EDIT_LIMITS.maxTextChars} placeholder="Caption" placeholderTextColor={colors.textFaint} style={styles.input} accessibilityLabel="Caption text" />
              <Text style={styles.small}>Emoji can’t be drawn on the video and are removed.</Text>
              <Tune label={`Shows from ${r1(cur.start)}s`} value={cur.start} min={0} max={Math.max(0.5, outLen - 0.2)} step={0.1} onChange={(v) => patchText(curIndex, { start: r1(v), end: Math.max(cur.end, r1(v) + 0.2) })} />
              <Tune label={`until ${r1(cur.end)}s`} value={cur.end} min={0.2} max={Math.max(0.4, outLen)} step={0.1} onChange={(v) => patchText(curIndex, { end: Math.max(r1(v), cur.start + 0.2) })} />
              <View style={styles.row}>
                <Chip label="Top" active={cur.y === 0.1} onPress={() => patchText(curIndex, { y: 0.1 })} />
                <Chip label="Middle" active={cur.y === 0.5} onPress={() => patchText(curIndex, { y: 0.5 })} />
                <Chip label="Bottom" active={cur.y === 0.85} onPress={() => patchText(curIndex, { y: 0.85 })} />
                <Chip label="Background" active={cur.box} onPress={() => patchText(curIndex, { box: !cur.box })} />
              </View>
              <View style={styles.row}>
                {TEXT_COLORS.map((c) => (
                  <Pressable key={c} onPress={() => patchText(curIndex, { color: c })} accessibilityLabel={`Colour ${c}`} style={[styles.swatch, { backgroundColor: c }, cur.color === c && styles.swatchOn]} />
                ))}
                <Pressable onPress={() => { set({ texts: texts.filter((_, k) => k !== curIndex) }); setTextIndex(0); }} hitSlop={8} accessibilityLabel="Remove text" style={{ marginLeft: 'auto' }}>
                  <Icon name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}

      {tool === 'sound' && (
        <View style={{ gap: space.sm }}>
          {hasMusic ? (
            <Text style={styles.small}>Your added music replaces this video’s sound. Fades still apply to it.</Text>
          ) : (
            <Tune label={edit.volume === 0 ? 'Original sound: muted' : `Original sound ${Math.round(edit.volume * 100)}%`} value={edit.volume} min={0} max={2} step={0.05} onChange={(v) => set({ volume: v })} />
          )}
          <Tune label={`Fade in ${edit.fadeIn}s`} value={edit.fadeIn} min={0} max={EDIT_LIMITS.maxFade} step={0.5} onChange={(v) => set({ fadeIn: v })} />
          <Tune label={`Fade out ${edit.fadeOut}s`} value={edit.fadeOut} min={0} max={EDIT_LIMITS.maxFade} step={0.5} onChange={(v) => set({ fadeOut: v })} />
        </View>
      )}
    </View>
  );
}

/** Keeps captions inside the clip when its length changes (call before sending). */
export { fitTextsToLength };

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceRaised, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  reset: { color: colors.textMuted, fontSize: 12, textDecorationLine: 'underline' },
  summary: { color: colors.brandSoft, fontSize: 12, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surfaceHigh },
  chipOn: { backgroundColor: colors.brand },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  small: { color: colors.textMuted, fontSize: 12 },
  value: { color: colors.text, fontSize: 14, fontWeight: '700' },
  cut: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: 2 },
  input: { backgroundColor: colors.surfaceHigh, color: colors.text, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 10, fontSize: 15 },
  swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: '#fff' },
});
