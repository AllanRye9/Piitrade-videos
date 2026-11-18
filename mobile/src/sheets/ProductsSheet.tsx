import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { api } from '../api';
import Sheet from '../components/Sheet';
import ProductEditor from '../components/ProductEditor';
import { Button, ErrorText, Icon } from '../components/ui';
import { mediaUrl } from '../config';
import { ProductDraft, draftFromSuggestion, draftsFromOwn, draftsToPayload, secondsText } from '../lib/productDrafts';
import { useApp } from '../state/AppContext';
import { useSites } from '../state/sites';
import type { ProductSuggestion, Video } from '../types';
import { colors, radius, space } from '../theme';

/** Edit the products pinned to one of your own videos, optionally starting from AI suggestions. */
export default function ProductsSheet({ video, onSaved }: { video: Video; onSaved?: () => void }) {
  const { closeSheet } = useApp();
  const sites = useSites();
  const [drafts, setDrafts] = useState<ProductDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<ProductSuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .getMyProducts(video.id)
      .then((r) => live && setDrafts(draftsFromOwn(r.products)))
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load products'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [video.id]);

  const siteIdBySlug = Object.fromEntries(sites.map((s) => [s.slug, s.id]));

  async function suggest() {
    setSuggesting(true);
    setError(null);
    try {
      setSuggestions((await api.suggestProducts(video.id)).suggestions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not get suggestions');
    } finally {
      setSuggesting(false);
    }
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await api.saveMyProducts(video.id, draftsToPayload(drafts));
      onSaved?.();
      closeSheet();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      setSaving(false);
    }
  }

  return (
    <Sheet title="Products in this video" onClose={closeSheet}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        {loading ? (
          <Text style={styles.muted}>Loading…</Text>
        ) : (
          <>
            <Button title={suggesting ? 'Looking at your video…' : 'Suggest products from this video'} icon="sparkles-outline" variant="secondary" onPress={suggest} busy={suggesting} />
            {suggestions ? (
              <View style={{ gap: space.sm }}>
                {suggestions.length === 0 ? <Text style={styles.muted}>Nothing matched on the connected shops. Add products by hand below.</Text> : null}
                {suggestions.map((s) => (
                  <View key={`${s.query}-${s.startMs}`} style={styles.suggestion}>
                    <Text style={styles.muted}>
                      Seen around {secondsText(s.startMs)}s–{secondsText(s.endMs)}s: “{s.query}”
                    </Text>
                    {s.candidates.map((c, ci) => (
                      <Pressable
                        key={c.url}
                        onPress={() => {
                          setDrafts((d) => [...d, draftFromSuggestion(s, ci, siteIdBySlug)]);
                          setSuggestions((all) => (all ? all.filter((x) => x !== s) : all));
                        }}
                        accessibilityRole="button"
                        style={styles.candidate}
                      >
                        {c.image ? <Image source={{ uri: mediaUrl(c.image) }} style={styles.thumb} contentFit="cover" /> : <View style={styles.thumb} />}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.candTitle} numberOfLines={1}>{c.title}</Text>
                          <Text style={styles.muted}>{c.price}</Text>
                        </View>
                        <Icon name="add-circle-outline" size={22} color={colors.brandSoft} />
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>
            ) : null}
            <ProductEditor value={drafts} onChange={setDrafts} sites={sites} durationSec={video.duration} />
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <Button title="Save" onPress={save} busy={saving} disabled={loading} />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md },
  muted: { color: colors.textFaint, fontSize: 12.5 },
  suggestion: { gap: 6, backgroundColor: colors.surfaceRaised, borderRadius: radius.md, padding: space.md },
  candidate: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surfaceHigh, borderRadius: radius.sm ?? 10, padding: space.sm },
  thumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.surfaceRaised },
  candTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
