import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { api } from '../api';
import type { VisualSearchResult } from '../types';
import Sheet from '../components/Sheet';
import { ErrorText, Icon } from '../components/ui';
import { mediaUrl } from '../config';
import { openProduct } from '../lib/products';
import { openWebLink } from '../lib/links';
import { useApp } from '../state/AppContext';
import { colors, radius, space } from '../theme';

/** "Find on Piitrade" — type what you saw in the video, get matching marketplace listings. */
export default function FindSheet({ initialQuery, videoId }: { initialQuery?: string; videoId?: string }) {
  const { closeSheet } = useApp();
  const [query, setQuery] = useState((initialQuery || '').replace(/^#/, ''));
  const [results, setResults] = useState<VisualSearchResult[] | null>(null);
  const [browseUrl, setBrowseUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  // Taps are logged against this video (so the creator and shop can be credited); with no video
  // context (shouldn't happen) fall back to opening the link directly.
  const open = (url: string) => (videoId ? openProduct(videoId, { url }) : openWebLink(url));

  const search = useCallback(async (q: string) => {
    if (!q.trim()) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    setResults(null);
    setBrowseUrl(null);
    try {
      const res = await api.marketplaceSearch(q.trim());
      if (id !== requestId.current) return;
      setResults(res.results);
      setBrowseUrl(res.browseUrl ?? null);
      setUnavailable((res.shops?.failed ?? []).map((f) => f.name));
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialQuery?.trim()) void search(initialQuery.replace(/^#/, ''));
    return () => { requestId.current++; };
  }, [initialQuery, search]);

  // Name the shop on each row only when the results come from more than one.
  const showShop = new Set((results ?? []).map((r) => r.shop?.id).filter(Boolean)).size > 1;

  return (
    <Sheet title="Find on Piitrade" onClose={closeSheet} maxHeight={0.88} fill>
      <View style={styles.searchRow}>
        <View style={styles.box}>
          <Icon name="search" size={18} color={colors.textMuted} />
          <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => search(query)} returnKeyType="search" placeholder="What did you see?" placeholderTextColor={colors.textFaint} style={styles.input} />
        </View>
      </View>
      <ErrorText>{error}</ErrorText>
      {loading && <ActivityIndicator color={colors.text} style={{ marginTop: 40 }} />}
      {!loading && results && (
        <FlatList
          style={{ flex: 1 }}
          data={results}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: space.lg, gap: space.md }}
          ListHeaderComponent={unavailable.length ? <Text style={styles.note}>Couldn’t reach {unavailable.join(', ')} just now, so these results may be incomplete.</Text> : undefined}
          ListEmptyComponent={<Text style={styles.empty}>No listings matched “{query}”.</Text>}
          ListFooterComponent={
            browseUrl ? (
              <Pressable onPress={() => open(browseUrl)} style={styles.browse}>
                <Text style={styles.browseText}>See all results on Piitrade</Text>
              </Pressable>
            ) : undefined
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => open(item.listingUrl)} style={styles.card}>
              <Image source={{ uri: mediaUrl(item.image) }} style={styles.img} contentFit="cover" />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={styles.price}>{item.price}</Text>
                {item.location || (showShop && item.shop) ? (
                  <Text style={styles.meta} numberOfLines={1}>
                    {[showShop ? item.shop?.name : null, item.location].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
              <Icon name="open-outline" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  searchRow: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  box: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingHorizontal: space.lg, height: 44 },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 0 },
  note: { color: colors.textMuted, fontSize: 12, marginBottom: space.sm },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: 30 },
  card: { flexDirection: 'row', gap: space.md, alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: radius.md, padding: space.md },
  img: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.surfaceHigh },
  name: { color: colors.text, fontSize: 14, fontWeight: '700' },
  price: { color: colors.brandSoft, fontSize: 14, fontWeight: '800' },
  meta: { color: colors.textMuted, fontSize: 12 },
  browse: { alignItems: 'center', padding: space.lg },
  browseText: { color: colors.brandSoft, fontWeight: '700' },
});
