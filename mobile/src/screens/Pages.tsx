import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import type { AccountSummary, TrendingHashtag, Video } from '../types';
import VideoFeed from '../components/VideoFeed';
import VideoGrid from '../components/VideoGrid';
import { Avatar, Button, Icon, IconButton, formatCount } from '../components/ui';
import { PageDescriptor, useApp } from '../state/AppContext';
import { colors, radius, space } from '../theme';

function PageShell({ title, children, overlay }: { title: string; children: React.ReactNode; overlay?: boolean }) {
  const insets = useSafeAreaInsets();
  const { popPage } = useApp();
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, zIndex: 20 }]}>
      <View style={[styles.header, { paddingTop: insets.top }, overlay && styles.headerOverlay]}>
        <IconButton name="chevron-back" label="Back" onPress={popPage} />
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 44 }} />
      </View>
      {children}
    </View>
  );
}

// ------------------------------------------------------------- viewer
function Viewer({ videos, index, title }: { videos: Video[]; index: number; title?: string }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <PageShell title={title || ''} overlay>
      <View style={StyleSheet.absoluteFill}>
        <VideoFeed videos={videos} height={height} initialIndex={index} bottomInset={insets.bottom} />
      </View>
    </PageShell>
  );
}

// ---------------------------------------------------------- single video
function SingleVideo({ id }: { id: string }) {
  const [video, setVideo] = useState<Video | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.getVideo(id).then((r) => setVideo(r.video)).catch((e) => setError(e instanceof Error ? e.message : 'Video not found'));
  }, [id]);
  if (video) return <Viewer videos={[video]} index={0} />;
  return (
    <PageShell title="Video">
      <View style={styles.center}>{error ? <Text style={styles.muted}>{error}</Text> : <ActivityIndicator color={colors.text} />}</View>
    </PageShell>
  );
}

// -------------------------------------------------------------- hashtag
function TagPage({ tag }: { tag: string }) {
  const { pushPage } = useApp();
  const [videos, setVideos] = useState<Video[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getHashtagVideos(tag).then((r) => { setVideos(r.videos); setCursor(r.nextCursor); }).catch(() => {}).finally(() => setLoading(false));
  }, [tag]);

  const more = useCallback(() => {
    if (!cursor) return;
    const c = cursor;
    setCursor(null);
    api.getHashtagVideos(tag, c).then((r) => { setVideos((v) => [...v, ...r.videos]); setCursor(r.nextCursor); }).catch(() => {});
  }, [cursor, tag]);

  return (
    <PageShell title={`#${tag}`}>
      {loading ? (
        <ActivityIndicator color={colors.text} style={{ marginTop: 40 }} />
      ) : (
        <VideoGrid videos={videos} emptyLabel={`No videos tagged #${tag} yet.`} onOpen={(i) => pushPage({ name: 'viewer', videos, index: i, title: `#${tag}` })} onEndReached={more} onEndReachedThreshold={0.6} />
      )}
    </PageShell>
  );
}

// -------------------------------------------------------------- account
function AccountPage({ handle }: { handle: string }) {
  const { pushPage, requireAuth } = useApp();
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);

  useEffect(() => {
    api.getAccount(handle).then((r) => { setAccount(r.account); setVideos(r.videos); setFollowing(!!r.account.isFollowing); }).catch((e) => setError(e instanceof Error ? e.message : 'Account not found'));
  }, [handle]);

  function follow() {
    requireAuth('Sign in to follow creators.', async () => {
      try {
        const res = await api.followAccount(handle);
        setFollowing(res.following);
        setAccount((a) => (a ? { ...a, followersCount: res.followersCount } : a));
      } catch {
        // leave state as-is
      }
    });
  }

  return (
    <PageShell title={`@${handle}`}>
      {error ? (
        <View style={styles.center}><Text style={styles.muted}>{error}</Text></View>
      ) : !account ? (
        <ActivityIndicator color={colors.text} style={{ marginTop: 40 }} />
      ) : (
        <VideoGrid
          videos={videos}
          emptyLabel="No videos yet."
          onOpen={(i) => pushPage({ name: 'viewer', videos, index: i, title: `@${handle}` })}
          ListHeaderComponent={
            <View style={styles.profileHead}>
              <Avatar uri={account.avatar} name={account.displayName || account.handle} size={84} />
              <Text style={styles.name}>{account.displayName || `@${account.handle}`}</Text>
              {account.bio ? <Text style={styles.bio}>{account.bio}</Text> : null}
              <View style={styles.stats}>
                {[['Videos', account.videoCount], ['Followers', account.followersCount], ['Likes', account.totalLikes]].map(([l, n]) => (
                  <View key={l as string} style={{ alignItems: 'center', flex: 1 }}>
                    <Text style={styles.statN}>{formatCount(n as number)}</Text>
                    <Text style={styles.muted}>{l}</Text>
                  </View>
                ))}
              </View>
              <Button title={following ? 'Following' : 'Follow'} variant={following ? 'secondary' : 'primary'} onPress={follow} style={{ alignSelf: 'stretch' }} />
            </View>
          }
        />
      )}
    </PageShell>
  );
}

// ------------------------------------------------------------- discover
function DiscoverPage() {
  const { pushPage } = useApp();
  const [q, setQ] = useState('');
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [tags, setTags] = useState<TrendingHashtag[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback((query?: string) => {
    setLoading(true);
    api.discoverAccounts(query || undefined).then((r) => setAccounts(r.accounts)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    api.getTrendingHashtags().then((r) => setTags(r.hashtags)).catch(() => {});
  }, [load]);

  return (
    <PageShell title="Discover">
      <View style={styles.searchBox}>
        <Icon name="search" size={18} color={colors.textMuted} />
        <TextInput value={q} onChangeText={setQ} onSubmitEditing={() => load(q.trim())} returnKeyType="search" placeholder="Find creators" placeholderTextColor={colors.textFaint} style={styles.searchInput} />
      </View>
      <FlatList
        data={accounts}
        keyExtractor={(a) => a.handle}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        ListHeaderComponent={
          tags.length ? (
            <View style={{ gap: space.sm, marginBottom: space.md }}>
              <Text style={styles.section}>Trending hashtags</Text>
              <View style={styles.tagWrap}>
                {tags.slice(0, 12).map((t) => (
                  <Pressable key={t.tag} onPress={() => pushPage({ name: 'tag', tag: t.tag })} style={styles.chip}>
                    <Text style={styles.chipText}>#{t.tag}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[styles.section, { marginTop: space.md }]}>Creators</Text>
            </View>
          ) : undefined
        }
        ListEmptyComponent={loading ? <ActivityIndicator color={colors.text} style={{ marginTop: 30 }} /> : <Text style={styles.muted}>No creators found.</Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => pushPage({ name: 'account', handle: item.handle })} style={styles.account}>
            <Avatar uri={item.avatar} name={item.displayName || item.handle} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={styles.accountName} numberOfLines={1}>{item.displayName || `@${item.handle}`}</Text>
              <Text style={styles.muted}>@{item.handle} · {formatCount(item.followersCount)} followers</Text>
            </View>
            <Icon name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
        )}
      />
    </PageShell>
  );
}

/** Renders the top of the page stack on top of the feed. */
export default function PageHost() {
  const { pages } = useApp();
  const page: PageDescriptor | undefined = pages[pages.length - 1];
  if (!page) return null;
  // key forces a fresh instance per stack depth/target
  const key = `${pages.length}-${page.name}`;
  switch (page.name) {
    case 'discover': return <DiscoverPage key={key} />;
    case 'account': return <AccountPage key={key} handle={page.handle} />;
    case 'tag': return <TagPage key={key} tag={page.tag} />;
    case 'video': return <SingleVideo key={key} id={page.id} />;
    case 'viewer': return <Viewer key={key} videos={page.videos} index={page.index} title={page.title} />;
  }
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.sm, paddingBottom: 4 },
  headerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30 },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '800', flex: 1, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  muted: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  profileHead: { alignItems: 'center', gap: space.sm, padding: space.lg },
  name: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: space.sm },
  bio: { color: colors.text, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  stats: { flexDirection: 'row', alignSelf: 'stretch', marginVertical: space.md },
  statN: { color: colors.text, fontSize: 17, fontWeight: '800' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingHorizontal: space.lg, height: 44, marginHorizontal: space.lg, marginTop: space.sm },
  searchInput: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 0 },
  section: { color: colors.textFaint, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { backgroundColor: colors.surfaceRaised, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
  chipText: { color: colors.brandSoft, fontWeight: '700', fontSize: 13 },
  account: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surfaceRaised, padding: space.md, borderRadius: radius.md },
  accountName: { color: colors.text, fontWeight: '800', fontSize: 15 },
});
