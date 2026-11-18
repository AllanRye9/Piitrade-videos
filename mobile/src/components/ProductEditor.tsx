import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SiteInfo } from '../types';
import { MAX_PRODUCTS, POSITIONS, ProductDraft, newDraft, positionIdOf } from '../lib/productDrafts';
import { colors, radius, space } from '../theme';
import { Icon, SectionLabel, TextField } from './ui';

interface Props {
  value: ProductDraft[];
  onChange: (next: ProductDraft[]) => void;
  sites: SiteInfo[];
  durationSec?: number | null;
}

/** Edits the products pinned to a video: shop, link, button text, when it shows and where it sits. */
export default function ProductEditor({ value, onChange, sites, durationSec }: Props) {
  const update = (key: string, patch: Partial<ProductDraft>) => onChange(value.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  return (
    <View style={{ gap: space.md }}>
      {value.map((d, i) => (
        <View key={d.key} style={styles.card}>
          <View style={styles.head}>
            <Text style={styles.title}>Product {i + 1}</Text>
            <Pressable onPress={() => onChange(value.filter((x) => x.key !== d.key))} accessibilityRole="button" accessibilityLabel={`Remove product ${i + 1}`} hitSlop={10}>
              <Icon name="trash-outline" size={18} color={colors.danger} />
            </Pressable>
          </View>
          {sites.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.sm }}>
              {[{ id: '', name: 'Auto-detect shop' }, ...sites].map((s) => (
                <Chip key={s.id || 'auto'} label={s.name} on={d.siteId === s.id} onPress={() => update(d.key, { siteId: s.id })} />
              ))}
            </ScrollView>
          ) : null}
          <TextField label="Product page link" value={d.url} onChangeText={(t) => update(d.key, { url: t })} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://…" maxLength={500} />
          <TextField label="Button text" value={d.title} onChangeText={(t) => update(d.key, { title: t })} maxLength={120} placeholder="e.g. Buy the red sneakers (optional)" />
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <TextField label="Shows from (s)" value={d.start} onChangeText={(t) => update(d.key, { start: t })} keyboardType="decimal-pad" placeholder="0" />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label="Until (s)" value={d.end} onChangeText={(t) => update(d.key, { end: t })} keyboardType="decimal-pad" placeholder={durationSec ? String(Math.round(durationSec)) : 'end'} />
            </View>
          </View>
          <SectionLabel>Where the button sits</SectionLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.sm }}>
            {POSITIONS.map((p) => (
              <Chip key={p.id} label={p.label} on={positionIdOf(d) === p.id} onPress={() => update(d.key, { x: p.x, y: p.y })} />
            ))}
          </ScrollView>
        </View>
      ))}
      {value.length < MAX_PRODUCTS ? (
        <Pressable onPress={() => onChange([...value, newDraft()])} accessibilityRole="button" style={styles.add}>
          <Icon name="add" size={18} color={colors.brandSoft} />
          <Text style={styles.addText}>Add a product</Text>
        </Pressable>
      ) : null}
      <Text style={styles.hint}>Each link must be a page on one of the connected shops. Up to {MAX_PRODUCTS} per video.</Text>
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, backgroundColor: colors.surfaceRaised, borderRadius: radius.md, padding: space.md },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.text, fontWeight: '700', fontSize: 14 },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceHigh, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)' },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  add: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  addText: { color: colors.brandSoft, fontWeight: '700', fontSize: 14 },
  hint: { color: colors.textFaint, fontSize: 12 },
});
