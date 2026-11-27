import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { api } from '../api';
import type { FrameSearchResponse, VisualSearchResult } from '../types';
import Sheet from '../components/Sheet';
import { ErrorText, Icon } from '../components/ui';
import { mediaUrl } from '../config';
import { openProduct } from '../lib/products';
import { openWebLink } from '../lib/links';
import { useApp } from '../state/AppContext';
import { colors, radius, space } from '../theme';

const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

/**
 * "Find on Piitrade". Opened from a video, it takes a screenshot of the video at the moment the viewer tapped
 * (the server cuts the frame out of the stored file — a phone can't screenshot a native video surface, it comes
 * out black), has the AI say what it shows, and lists matching listings. If a frame can't be read or what it
 * shows isn't listed, the server tries nearby frames and finally the video's own title, and says which it used.
 * The box underneath still lets the viewer type what they saw.
 */
export default function FindSheet({ initialQuery, videoId, positionMs }: { initialQuery?: string; videoId?: string; positionMs?: number }) {
  const { closeSheet } = useApp();
  const [query, setQuery] = useState((initialQuery || '').replace(/^#/, ''));
  const [results, setResults] = useState<VisualSearchResult[] | null>(null);
  const [browseUrl, setBrowseUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  // The screenshot that was analysed and what the AI made of it.
  const [shot, setShot] = useState<{ frame?: string; identification?: string; atMs?: number; note?: string; source: 'frame' | 'title' } | null>(null);
  const [scanning, setScanning] = useState(false);

  // Taps are logged against this video (so the creator and shop can be credited); with no video
  // context (shouldn't happen) fall back to opening the link directly.
  const open = (url: string) => (videoId ? openProduct(videoId, { url }) : openWebLink(url));

  const search = useCallback(async (q: string) => {
    if (!q.trim()) return;
    const id = ++requestId.current;
    setShot(null);
    setScanning(false);
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

  const applyShot = (res: FrameSearchResponse) => {
    setResults(res.results);
    setBrowseUrl(res.browseUrl ?? null);
    setUnavailable((res.shops?.failed ?? []).map((f) => f.name));
    setShot({ frame: res.frame, identification: res.identification, atMs: res.atMs, note: res.note, source: res.source });
    if (res.source === 'title' && res.query) setQuery(res.query);
    else if (res.identification) setQuery(res.identification);
  };

  const scan = useCallback(async (vid: string, atMs: number, fallback: string) => {
    const id = ++requestId.current;
    setLoading(true);
    setScanning(true);
    setError(null);
    setResults(null);
    setShot(null);
    try {
      const res = await api.frameSearch(vid, atMs);
      if (id !== requestId.current) return;
      applyShot(res);
    } catch (e) {
      if (id !== requestId.current) return;
      // The screenshot route failed (offline, server error): do what this sheet always did — search by the video's own tag/title.
      setScanning(false);
      if (fallback.trim()) {
        setLoading(false);
        void search(fallback);
        setError(`Couldn’t analyse the picture (${e instanceof Error ? e.message : 'search failed'}) — showing results for “${fallback.trim()}” instead.`);
      } else {
        setError(e instanceof Error ? e.message : 'Search failed');
      }
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setScanning(false);
      }
    }
  }, [search]);

  useEffect(() => {
    const fallback = (initialQuery || '').replace(/^#/, '');
    if (videoId && positionMs !== undefined) void scan(videoId, positionMs, fallback);
    else if (fallback.trim()) void search(fallback);
    return () => { requestId.current++; };
  }, [initialQuery, videoId, positionMs, scan, search]);

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
      {scanning && (
        <View style={styles.scan}>
          <ActivityIndicator color={colors.text} />
          <Text style={styles.scanText}>Taking a screenshot and analysing it…</Text>
        </View>
      )}
      {!loading && shot && (
        <View style={styles.shot}>
          {shot.frame ? <Image source={{ uri: shot.frame }} style={styles.shotImg} contentFit="cover" /> : null}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.shotTitle}>
              {shot.source === 'frame' && shot.identification ? `Looks like “${shot.identification}”` : 'Searched by the video’s title'}
            </Text>
            <Text style={styles.meta}>
              {shot.source === 'frame' && shot.atMs !== undefined ? `From the picture at ${mmss(shot.atMs)}` : shot.note ?? ''}
            </Text>
            {shot.source === 'frame' ? null : shot.identification ? <Text style={styles.meta}>The picture looked like “{shot.identification}”.</Text> : null}
          </View>
        </View>
      )}
      {loading && !scanning && <ActivityIndicator color={colors.text} style={{ marginTop: 40 }} />}
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
  scan: { flexDirection: 'row', alignItems: 'center', gap: space.md, justifyContent: 'center', marginTop: 40, paddingHorizontal: space.xl },
  scanText: { color: colors.textMuted, fontSize: 14 },
  shot: { flexDirection: 'row', gap: space.md, alignItems: 'center', marginHorizontal: space.lg, marginBottom: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  shotImg: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.surfaceHigh },
  shotTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  browse: { alignItems: 'center', padding: space.lg },
  browseText: { color: colors.brandSoft, fontWeight: '700' },
});
