import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { api } from '../api';
import type { ProductPin, ProductSuggestion, SiteInfo, Video } from '../types';
import Sheet from '../components/Sheet';
import { ErrorText, Icon } from '../components/ui';
import { clock } from '../lib/products';
import { useApp } from '../state/AppContext';
import { colors, radius, space } from '../theme';

const MAX_PINS = 8;
const STEP_MS = 1000;
const MIN_WINDOW_MS = 1000;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** − 0:07 + control for one end of a time window. */
function Stepper({ label, valueMs, onChange, disabled }: { label: string; valueMs: number | null; onChange: (ms: number) => void; disabled?: boolean }) {
  const v = valueMs ?? 0;
  return (
    <View style={[styles.stepper, disabled && { opacity: 0.4 }]}>
      <Text style={styles.stepLabel}>{label}</Text>
      <Pressable disabled={disabled} onPress={() => onChange(v - STEP_MS)} hitSlop={8} style={styles.stepBtn} accessibilityLabel={`${label} earlier`}>
        <Icon name="remove" size={16} />
      </Pressable>
      <Text style={styles.stepValue}>{disabled ? 'end' : clock(v)}</Text>
      <Pressable disabled={disabled} onPress={() => onChange(v + STEP_MS)} hitSlop={8} style={styles.stepBtn} accessibilityLabel={`${label} later`}>
        <Icon name="add" size={16} />
      </Pressable>
    </View>
  );
}

/**
 * Creator tool: pin shop products to moments of a video. Each pin can show for a time window; viewers
 * see its chip only then. "Suggest from my video" samples a few frames server-side (bounded cost) and
 * proposes matching listings — nothing is saved until the creator confirms and presses Save.
 */
export default function ProductsSheet({ video }: { video: Video }) {
  const { closeSheet } = useApp();
  const maxMs = Math.max(MIN_WINDOW_MS * 2, Math.round((video.duration ?? 60) * 1000));
  const [pins, setPins] = useState<ProductPin[] | null>(null);
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [suggestions, setSuggestions] = useState<ProductSuggestion[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getMyProducts(video.id).then((r) => setPins(r.products)).catch((e) => { setPins([]); setError(e instanceof Error ? e.message : 'Could not load products'); });
    api.getSites().then((r) => setSites(r.sites)).catch(() => {});
  }, [video.id]);

  const list = pins ?? [];
  const update = (i: number, patch: Partial<ProductPin>) => { setSaved(false); setPins(list.map((p, n) => (n === i ? { ...p, ...patch } : p))); };
  const remove = (i: number) => { setSaved(false); setPins(list.filter((_, n) => n !== i)); };

  function add(pin: ProductPin) {
    if (list.length >= MAX_PINS) return setError(`You can pin up to ${MAX_PINS} products.`);
    if (list.some((p) => p.url === pin.url)) return setError('That product is already pinned.');
    setError(null);
    setSaved(false);
    setPins([...list, pin]);
  }

  function addManual() {
    const link = url.trim();
    if (!/^https?:\/\//i.test(link)) return setError('Paste a full link starting with https://');
    if (sites.length && !sites.some((s) => hostOf(link) === hostOf(s.baseUrl) || hostOf(link).endsWith(`.${hostOf(s.baseUrl)}`))) {
      return setError(`Links must be on a connected shop: ${sites.map((s) => hostOf(s.baseUrl)).join(', ')}`);
    }
    add({ url: link, title: '', startMs: 0, endMs: null });
    setUrl('');
  }

  async function suggest() {
    setSuggesting(true);
    setSuggestNote(null);
    setError(null);
    try {
      const r = await api.suggestProducts(video.id);
      setSuggestions(r.suggestions);
      if (r.suggestions.length === 0) setSuggestNote('No matching listings found in this video.');
    } catch (e) {
      setSuggestNote(e instanceof Error ? e.message : 'Suggestions are unavailable right now.');
    } finally {
      setSuggesting(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.setProducts(video.id, list.map((p) => ({ url: p.url, title: p.title.trim(), startMs: p.startMs, endMs: p.endMs, x: p.x ?? null, y: p.y ?? null })));
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title="Pin products" onClose={closeSheet} maxHeight={0.9}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.help}>Viewers see a shop chip while the product is on screen, and you earn commission on sales that start from it.</Text>

        {pins === null ? (
          <ActivityIndicator color={colors.textMuted} />
        ) : (
          list.map((p, i) => (
            <View key={p.url + i} style={styles.pin}>
              <View style={styles.pinHead}>
                <Icon name="bag-handle-outline" size={16} color={colors.brandSoft} />
                <Text style={styles.pinHost} numberOfLines={1}>{hostOf(p.url)}</Text>
                <Pressable onPress={() => remove(i)} hitSlop={8} accessibilityLabel="Remove product"><Icon name="trash-outline" size={18} color={colors.danger} /></Pressable>
              </View>
              <TextInput value={p.title} onChangeText={(t) => update(i, { title: t })} placeholder="Label shown on the chip (optional)" placeholderTextColor={colors.textFaint} maxLength={120} style={styles.input} />
              <View style={styles.times}>
                <Stepper label="From" valueMs={p.startMs} onChange={(ms) => update(i, { startMs: Math.max(0, Math.min(ms, (p.endMs ?? maxMs) - MIN_WINDOW_MS)) })} />
                <Stepper label="To" valueMs={p.endMs} disabled={p.endMs === null} onChange={(ms) => update(i, { endMs: Math.min(maxMs, Math.max(ms, p.startMs + MIN_WINDOW_MS)) })} />
              </View>
              <Pressable onPress={() => update(i, { endMs: p.endMs === null ? Math.min(maxMs, p.startMs + 4000) : null })}>
                <Text style={styles.link}>{p.endMs === null ? 'Show only for a time window' : 'Show until the end instead'}</Text>
              </Pressable>
            </View>
          ))
        )}

        <View style={styles.block}>
          <Text style={styles.section}>Add a product link</Text>
          <TextInput value={url} onChangeText={setUrl} placeholder={sites[0] ? `${sites[0].baseUrl}/listings/…` : 'https://shop.example.com/product'} placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.input} />
          {sites.length > 0 && <Text style={styles.hint}>Connected shops: {sites.map((s) => s.name).join(', ')}</Text>}
          <Pressable onPress={addManual} style={styles.secondary}><Text style={styles.secondaryText}>Add</Text></Pressable>
        </View>

        <View style={styles.block}>
          <Text style={styles.section}>Suggestions</Text>
          <Pressable onPress={suggest} disabled={suggesting} style={[styles.secondary, suggesting && { opacity: 0.6 }]}>
            <Text style={styles.secondaryText}>{suggesting ? 'Looking through your video…' : 'Suggest from my video'}</Text>
          </Pressable>
          {suggestNote && <Text style={styles.hint}>{suggestNote}</Text>}
          {suggestions?.map((s) => (
            <View key={s.url} style={styles.suggestion}>
              {s.image ? <Image source={{ uri: s.image }} style={styles.thumb} contentFit="cover" /> : <View style={styles.thumb} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.sTitle} numberOfLines={2}>{s.title}</Text>
                <Text style={styles.sMeta}>{s.price} · {clock(s.startMs)}–{clock(s.endMs)}</Text>
              </View>
              <Pressable onPress={() => add({ url: s.url, title: s.title.slice(0, 60), startMs: s.startMs, endMs: s.endMs })} hitSlop={8}><Text style={styles.link}>Add</Text></Pressable>
            </View>
          ))}
        </View>

        <ErrorText>{error}</ErrorText>
        {saved && <Text style={styles.ok}>Saved. Pull the feed down to refresh and see the chips on the video.</Text>}
        <Pressable onPress={save} disabled={saving || pins === null} style={[styles.save, (saving || pins === null) && { opacity: 0.6 }]}>
          <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save products'}</Text>
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.xl, paddingTop: space.sm, gap: space.lg },
  help: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  pin: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: space.sm },
  pinHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pinHost: { flex: 1, color: colors.text, fontWeight: '700', fontSize: 14 },
  input: { backgroundColor: colors.surfaceRaised, color: colors.text, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: 10, fontSize: 14 },
  times: { flexDirection: 'row', gap: space.md },
  stepper: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 6 },
  stepLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', width: 34 },
  stepBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  stepValue: { flex: 1, textAlign: 'center', color: colors.text, fontWeight: '700', fontSize: 13 },
  link: { color: colors.brandSoft, fontSize: 13, fontWeight: '700' },
  block: { gap: space.sm },
  section: { color: colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  hint: { color: colors.textFaint, fontSize: 12 },
  secondary: { alignSelf: 'flex-start', backgroundColor: colors.surfaceHigh, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: 10 },
  secondaryText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.sm },
  thumb: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceHigh },
  sTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
  sMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  ok: { color: colors.success, fontSize: 13 },
  save: { backgroundColor: colors.brand, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
