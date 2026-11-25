import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { api } from '../api';
import type { SavedItem } from '../types';
import Sheet from '../components/Sheet';
import { ErrorText, Icon } from '../components/ui';
import { mediaUrl } from '../config';
import { openWebLink } from '../lib/links';
import { openProduct } from '../lib/products';
import { useApp } from '../state/AppContext';
import { colors, radius, space } from '../theme';

/**
 * Everything the viewer tapped to save while watching. Nothing here interrupts a video: this is where
 * they come back, on their own time, to look again and buy. "Buy" goes through the attribution
 * redirect for the video it came from, so the creator is still credited for the sale.
 */
export default function SavedItemsSheet() {
  const { closeSheet } = useApp();
  const [items, setItems] = useState<SavedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.getSavedItems().then((r) => setItems(r.items)).catch((e) => { setItems((cur) => cur ?? []); setError(e instanceof Error ? e.message : 'Could not load your saved items'); });
  }, []);
  useEffect(load, [load]);

  async function remove(item: SavedItem) {
    const before = items;
    setItems((cur) => (cur ?? []).filter((x) => x.id !== item.id)); // optimistic
    try {
      await api.deleteSavedItem(item.id);
    } catch (e) {
      setItems(before);
      setError(e instanceof Error ? e.message : 'Could not remove that item');
    }
  }

  const buy = (item: SavedItem) => (item.videoId ? openProduct(item.videoId, { url: item.url }) : openWebLink(item.url));

  return (
    <Sheet title={items && items.length ? `Saved items (${items.length})` : 'Saved items'} onClose={closeSheet} maxHeight={0.85}>
      {items === null ? (
        <ActivityIndicator color={colors.textMuted} style={{ marginTop: 30 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.body}
          ListHeaderComponent={<ErrorText>{error}</ErrorText>}
          ListEmptyComponent={
            error ? null : (
            <View style={styles.empty}>
              <Icon name="bookmark-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Nothing saved yet</Text>
              <Text style={styles.emptyText}>While you watch, tap a product tag to save it. The video keeps playing, and your items wait here for when you’re ready.</Text>
            </View>
            )
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              {item.poster ? <Image source={{ uri: mediaUrl(item.poster) }} style={styles.thumb} contentFit="cover" /> : <View style={styles.thumb} />}
              <View style={styles.info}>
                <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                <Text style={styles.meta} numberOfLines={1}>{item.host}{item.videoTitle ? ` · from “${item.videoTitle}”` : ''}</Text>
                <View style={styles.actions}>
                  <Pressable onPress={() => buy(item)} style={styles.buy} accessibilityRole="link" accessibilityLabel={`Open ${item.title} on ${item.host}`}>
                    <Text style={styles.buyText}>View on {item.site || item.host}</Text>
                  </Pressable>
                  <Pressable onPress={() => remove(item)} hitSlop={10} accessibilityLabel={`Remove ${item.title}`}>
                    <Icon name="trash-outline" size={18} color={colors.danger} />
                  </Pressable>
                </View>
              </View>
            </View>
          )}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.xl, paddingTop: space.sm, gap: space.md },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: space.sm },
  emptyText: { color: colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 280 },
  row: { flexDirection: 'row', gap: space.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.sm },
  thumb: { width: 64, height: 86, borderRadius: radius.sm, backgroundColor: colors.surfaceHigh },
  info: { flex: 1, gap: 4, justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 14, fontWeight: '700' },
  meta: { color: colors.textMuted, fontSize: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  buy: { backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: 8 },
  buyText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
