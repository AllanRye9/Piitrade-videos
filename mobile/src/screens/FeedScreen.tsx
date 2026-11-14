import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import type { Video } from '../types';
import VideoFeed from '../components/VideoFeed';
import { Avatar, Button, Icon, IconButton } from '../components/ui';
import { useApp, useProfile } from '../state/AppContext';
import { addRecentSearch } from '../state/stores';
import { colors, radius, space } from '../theme';

type Mode = 'latest' | 'trending';
export const BOTTOM_BAR_HEIGHT = 64;

export default function FeedScreen({ onLayoutHeight }: { onLayoutHeight?: (h: number) => void }) {
  const insets = useSafeAreaInsets();
  const { signedIn, openSheet, requireAuth, pushPage, unreadCount } = useApp();
  const profile = useProfile();

  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mode, setMode] = useState<Mode>('latest');
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [height, setHeight] = useState(0);

  const loadFeed = useCallback(async (m: Mode) => {
    setError(null);
    setSearching(false);
    try {
      if (m === 'trending') {
        const res = await api.getTrendingVideos();
        setVideos(res.videos);
        setNextCursor(null);
      } else {
        const res = await api.listVideos();
        setVideos(res.videos);
        setNextCursor(res.nextCursor);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load videos');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadFeed(mode).finally(() => setLoading(false));
  }, [mode, loadFeed]);

  // Guests browse with an anonymous session; once they sign in the feed reloads so liked/saved state is theirs.
  useEffect(() => {
    if (!loading) loadFeed(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  const loadMore = useCallback(() => {
    if (mode !== 'latest' || searching || loadingMore || !nextCursor) return;
    setLoadingMore(true);
    api
      .listVideos(nextCursor)
      .then((res) => {
        setVideos((prev) => [...prev, ...res.videos]);
        setNextCursor(res.nextCursor);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [mode, searching, loadingMore, nextCursor]);

  async function runSearch() {
    const q = query.trim();
    if (!q) {
      setSearching(false);
      loadFeed(mode);
      return;
    }
    addRecentSearch(q);
    setLoading(true);
    setSearching(true);
    setNextCursor(null);
    try {
      const res = await api.searchVideos(q);
      setVideos(res.videos);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  function closeSearch() {
    setSearchOpen(false);
    setQuery('');
    if (searching) {
      setLoading(true);
      loadFeed(mode).finally(() => setLoading(false));
    }
  }

  const bottomInset = BOTTOM_BAR_HEIGHT + Math.max(insets.bottom, 0);

  return (
    <View style={styles.root}>
      {/* The video fills the whole screen; chrome floats on top. */}
      <View style={StyleSheet.absoluteFill} onLayout={(e) => { setHeight(e.nativeEvent.layout.height); onLayoutHeight?.(e.nativeEvent.layout.height); }}>
        {height > 0 && loading && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.text} />
          </View>
        )}
        {height > 0 && !loading && error && (
          <View style={styles.center}>
            <Text style={styles.muted}>{error}</Text>
            <Button title="Retry" variant="secondary" onPress={() => { setLoading(true); loadFeed(mode).finally(() => setLoading(false)); }} style={{ marginTop: space.md }} />
          </View>
        )}
        {height > 0 && !loading && !error && videos.length === 0 && (
          <View style={styles.center}>
            <Text style={styles.muted}>{searching ? 'No videos match your search.' : 'No videos yet.'}</Text>
            {!searching && <Button title="Upload the first one" onPress={() => requireAuth('Sign in to upload videos.', () => openSheet({ type: 'upload' }))} style={{ marginTop: space.md }} />}
          </View>
        )}
        {height > 0 && !loading && !error && videos.length > 0 && (
          <VideoFeed
            key={`${mode}-${searching ? 'q' : 'f'}-${signedIn ? 'u' : 'g'}`}
            videos={videos}
            height={height}
            bottomInset={bottomInset}
            onNearEnd={loadMore}
            onRefresh={() => loadFeed(mode)}
          />
        )}
      </View>

      {/* Top bar */}
      <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + 4 }]}>
        {searchOpen ? (
          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <Icon name="search" size={18} color={colors.textMuted} />
              <TextInput
                autoFocus
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={runSearch}
                returnKeyType="search"
                placeholder="Search videos, #tags"
                placeholderTextColor={colors.textFaint}
                style={styles.searchInput}
              />
            </View>
            <Pressable onPress={closeSearch} hitSlop={8}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.topRow}>
            <IconButton name="search" label="Search" onPress={() => setSearchOpen(true)} />
            <View style={styles.modes}>
              {(['latest', 'trending'] as Mode[]).map((m) => (
                <Pressable key={m} onPress={() => setMode(m)} hitSlop={6} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}>
                  <Text style={[styles.mode, mode === m && styles.modeActive]}>{m === 'latest' ? 'Latest' : 'Trending'}</Text>
                  {mode === m && <View style={styles.modeUnderline} />}
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() => (signedIn ? openSheet({ type: 'profile' }) : openSheet({ type: 'auth', reason: 'Log in to see your profile.' }))}
              accessibilityRole="button"
              accessibilityLabel={signedIn ? 'Your profile' : 'Sign in'}
              style={styles.avatarBtn}
            >
              {signedIn ? <Avatar uri={profile.avatar} name={profile.displayName || profile.handle} size={34} /> : <Text style={styles.signIn}>Sign in</Text>}
            </Pressable>
          </View>
        )}
      </View>

      {/* Bottom bar */}
      <View style={[styles.bottom, { height: BOTTOM_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }]}>
        <BarItem icon="home" label="Home" active onPress={() => {}} />
        <BarItem icon="compass-outline" label="Discover" onPress={() => pushPage({ name: 'discover' })} />
        <Pressable onPress={() => requireAuth('Sign in to upload videos.', () => openSheet({ type: 'upload' }))} accessibilityRole="button" accessibilityLabel="Upload video" style={styles.plusWrap}>
          <View style={styles.plus}>
            <Icon name="add" size={28} color="#fff" />
          </View>
        </Pressable>
        <BarItem
          icon="notifications-outline"
          label="Inbox"
          badge={signedIn ? unreadCount : 0}
          onPress={() => requireAuth('Sign in to see your notifications.', () => openSheet({ type: 'notifications' }))}
        />
        <BarItem icon="settings-outline" label="Settings" onPress={() => (signedIn ? openSheet({ type: 'settings' }) : openSheet({ type: 'auth', reason: 'Log in to manage your account.' }))} />
      </View>
    </View>
  );
}

function BarItem({ icon, label, onPress, active, badge }: { icon: React.ComponentProps<typeof Icon>['name']; label: string; onPress: () => void; active?: boolean; badge?: number }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.item}>
      <View>
        <Icon name={icon} size={24} color={active ? colors.text : colors.textMuted} />
        {badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.itemLabel, active && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  muted: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: space.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 48 },
  modes: { flexDirection: 'row', gap: space.xl, alignItems: 'center' },
  mode: { color: 'rgba(255,255,255,0.6)', fontSize: 16, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
  modeActive: { color: colors.text },
  modeUnderline: { height: 2, borderRadius: 1, backgroundColor: colors.text, marginTop: 3, alignSelf: 'center', width: 22 },
  avatarBtn: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  signIn: { color: colors.text, fontWeight: '800', fontSize: 13, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, overflow: 'hidden' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, height: 48, paddingHorizontal: space.sm },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: 'rgba(30,30,32,0.92)', borderRadius: radius.pill, paddingHorizontal: space.lg, height: 40 },
  searchInput: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 0 },
  cancel: { color: colors.text, fontWeight: '700' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', backgroundColor: 'rgba(0,0,0,0.92)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, height: BOTTOM_BAR_HEIGHT },
  itemLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700' },
  plusWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', height: BOTTOM_BAR_HEIGHT },
  plus: { width: 52, height: 36, borderRadius: 12, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -4, right: -8, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
